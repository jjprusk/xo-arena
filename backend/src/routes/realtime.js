// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * /api/v1/rt — client → server side of the SSE+POST transport.
 *
 * This router is the home for every POST that used to be a Socket.io
 * `socket.emit(...)` in the legacy transport. Each route resolves the user
 * via optionalAuth (so guests pass through) and the live SSE connection via
 * requireSseSession (the `X-SSE-Session` header), then calls into the same
 * service code the Socket.io handlers used to call. Routes that genuinely
 * require a logged-in user assert `req.auth?.userId` themselves.
 *
 * Phase ordering: Phase 0 ships only the skeleton + the realtime mode
 * endpoint. Subsequent phases add actual handlers (idle/pong, table watch,
 * game move, etc.) one feature at a time, gated behind per-feature flags
 * read from SystemConfig.
 *
 * Why one router instead of one per phase:
 *   - Single mount point in index.js — phases add files but don't churn the
 *     wiring.
 *   - The `requireSseSession` middleware only needs to be defined once.
 */
import { Router } from 'express'
import { optionalAuth } from '../middleware/auth.js'
import * as sseSessions from '../realtime/sseSessions.js'
import { targetMachineFor, sendReplay } from '../realtime/flyReplay.js'
import { getSystemConfig } from '../services/skillService.js'
import { handleIdlePong } from '../services/tableService.js'
import { joinMatchTable, TournamentMatchError } from '../services/tournamentMatchService.js'
import {
  watchForSession,
  unwatchForSession,
  dualEmitPresence,
} from '../services/tablePresenceService.js'
import { getPresence as getTablePresence } from '../realtime/tablePresence.js'
import { appendToStream } from '../lib/eventStream.js'
import * as pongRunner from '../realtime/pongRunner.js'
import * as tableFlow from '../services/tableFlowService.js'
import { cancelForfeitFor } from '../services/disconnectForfeitService.js'
import * as idleTimers from '../realtime/idleTimers.js'
import db from '../lib/db.js'
import logger from '../logger.js'

/**
 * Middleware: requires an active SSE connection identified by `X-SSE-Session`.
 *
 * Attaches `req.sseSession = { sessionId, userId, joinedTables, ... }` for
 * downstream handlers. Returns 409 if the header is missing or the session
 * has been disposed — clients should reopen their EventSource and retry once.
 */
export function requireSseSession(req, res, next) {
  const sessionId = req.headers['x-sse-session']
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(409).json({ error: 'sse-session-required', code: 'SSE_SESSION_MISSING' })
  }
  // Multi-machine routing: the session lives in an in-memory Map on the
  // machine that opened the SSE connection. The session id encodes that
  // machine's id as a prefix; if this POST landed on a different machine,
  // hand it back to Fly's edge proxy with a Fly-Replay header so the right
  // machine handles it. Off-Fly (no FLY_MACHINE_ID env), this is a no-op.
  const ownerMachineId = targetMachineFor(sessionId)
  if (ownerMachineId) return sendReplay(res, ownerMachineId)
  const entry = sseSessions.get(sessionId)
  if (!entry) {
    return res.status(409).json({ error: 'sse-session-required', code: 'SSE_SESSION_EXPIRED' })
  }
  // Defensive: if the session was registered with a userId, it must match
  // the authenticated request. (Anonymous SSE — guest play — leaves userId
  // null and skips this check.)
  if (entry.userId && req.auth?.userId) {
    // entry.userId is the domain User.id; req.auth.userId is the BA user id.
    // They differ on purpose. The /rt/* handlers that need correlation will
    // do their own User lookup; here we only assert the session is alive.
  }
  req.sseSession = { sessionId, ...entry }
  sseSessions.touch(sessionId)
  next()
}

const router = Router()

// GET /api/v1/realtime/mode
//
// Mounted at /api/v1/realtime/mode (NOT under /rt) so it's reachable before
// the client has an SSE session. Returns the current transport selection so
// the client can decide whether to open a Socket.io connection, an SSE
// connection, or both.
//
//   transport:   'socketio' | 'dual' | 'sse'   (overall default)
//   perFeature:  per-feature overrides, e.g. { idle: 'sse', tables: 'socketio' }
//
// All values come from SystemConfig (no deploy needed to flip).
export const modeRouter = Router()
modeRouter.get('/mode', async (_req, res) => {
  try {
    const transport = (await getSystemConfig('realtime.transport', 'socketio')) || 'socketio'
    const perFeature = {
      idle:        (await getSystemConfig('realtime.idle.via',         null)),
      guide:       (await getSystemConfig('realtime.guide.via',        null)),
      tournament:  (await getSystemConfig('realtime.tournament.via',   null)),
      ml:          (await getSystemConfig('realtime.ml.via',           null)),
      admin:       (await getSystemConfig('realtime.admin.via',        null)),
      tables:      (await getSystemConfig('realtime.tables.presence.via', null)),
      pong:        (await getSystemConfig('realtime.pong.via',         null)),
      gameflow:    (await getSystemConfig('realtime.gameflow.via',     null)),
    }
    res.json({ transport, perFeature })
  } catch (err) {
    logger.warn({ err }, 'GET /realtime/mode failed — defaulting to socketio')
    res.json({ transport: 'socketio', perFeature: {} })
  }
})

// All /rt/* routes share two pieces of middleware:
//
//  • optionalAuth    — attaches req.auth if a Bearer token + live BA session
//                      are present, otherwise sets req.auth = null. Routes
//                      that genuinely require a logged-in user check this
//                      explicitly; guest-friendly routes (pong, table create,
//                      table join, game move, etc.) accept null.
//  • requireSseSession — every POST must carry an X-SSE-Session header
//                      pointing at a live SSE connection. Anonymous SSE
//                      sessions (Phase 7a / Risk R3) work the same way.
router.use(optionalAuth, requireSseSession)

// POST /api/v1/rt/tables/:slug/idle/pong
//
// Replaces `socket.emit('idle:pong')` for clients on the SSE+POST transport.
// Resets the idle timer for the authenticated user at the given table.
//
// Returns 200 + { ok: true } on a successful reset, 404 if the table does
// not exist, 409 if the user is not connected to it, and 410 if the table
// is no longer ACTIVE. The client treats any non-200 as a no-op (the next
// idle warning will arrive normally if the connection is genuinely stale).
router.post('/tables/:slug/idle/pong', async (req, res) => {
  try {
    const { slug } = req.params
    // Idle keep-alive resets the per-user idle timer keyed by domain User.id;
    // a guest has no domain user, so the legacy socket idle path simply isn't
    // engaged for them. Treat a guest call as a no-op (200) — the client
    // also gates this POST on auth, but the route stays tolerant so a stale
    // `visibilitychange` ping after sign-out doesn't surface as a console
    // error.
    if (!req.auth?.userId) return res.json({ ok: true, skipped: 'guest' })
    // Resolve the domain User.id from the BA user id in req.auth.userId — the
    // service-layer code keys idle timers by domain id (same as the legacy
    // socket handler).
    const appUser = await db.user.findUnique({
      where:  { betterAuthId: req.auth.userId },
      select: { id: true },
    })
    if (!appUser?.id) return res.status(401).json({ error: 'User not found' })

    const io = req.app.get('io')
    const result = await handleIdlePong({ io, userId: appUser.id, slug })
    if (result.ok) {
      // Reset the idle warn/forfeit chain. result.tableId is set by
      // handleIdlePong on success; arm is a no-op for falsy tableId.
      idleTimers.arm({ userId: appUser.id, tableId: result.tableId, slug, io }).catch(() => {})
      return res.json({ ok: true })
    }
    if (result.reason === 'not-found') return res.status(404).json({ error: 'Table not found' })
    if (result.reason === 'not-active') return res.status(410).json({ error: 'Table not active' })
    if (result.reason === 'no-session') return res.status(409).json({ error: 'No active socket for this user/table' })
    return res.status(400).json({ error: 'Bad request' })
  } catch (err) {
    logger.error({ err }, 'POST /rt/tables/:slug/idle/pong failed')
    return res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/v1/rt/tournaments/matches/:id/table
//
// Replaces `socket.emit('tournament:room:join', { matchId })` for clients on
// the SSE+POST transport. The same `tournamentMatchService.joinMatchTable`
// runs on both sides, so a Phase 3 partial rollout (one player on socket,
// the other on SSE+POST) lands them on the same DB Table row.
//
// Returns 200 + { slug, mark, tournamentId, matchId, bestOfN, action } on
// success. SSE side-effect: a `tournament:<tournamentId>:table:ready` event
// is appended for the tournament page to react to (server-only fan-out;
// the client doesn't depend on it for slug/mark — those come back in the
// HTTP response).
router.post('/tournaments/matches/:id/table', async (req, res) => {
  try {
    const { id: matchId } = req.params

    // Tournament participation requires an authenticated user — guests can't
    // own a TournamentParticipant row.
    if (!req.auth?.userId) return res.status(401).json({ error: 'Authentication required' })

    const appUser = await db.user.findUnique({
      where:  { betterAuthId: req.auth.userId },
      select: { id: true, betterAuthId: true, displayName: true },
    })
    if (!appUser?.betterAuthId) return res.status(401).json({ error: 'User not found' })

    const result = await joinMatchTable({ user: appUser, matchId })

    const readyPayload = {
      slug:          result.slug,
      mark:          result.mark,
      tournamentId:  result.tournamentId,
      matchId:       result.matchId,
      bestOfN:       result.bestOfN,
    }
    appendToStream(`tournament:${result.tournamentId}:table:ready`, readyPayload).catch(() => {})

    return res.json({ ...readyPayload, action: result.action })
  } catch (err) {
    if (err instanceof TournamentMatchError) {
      if (err.code === 'NOT_FOUND')       return res.status(404).json({ error: err.message, code: err.code })
      if (err.code === 'NOT_READY')       return res.status(409).json({ error: err.message, code: err.code })
      if (err.code === 'NOT_PARTICIPANT') return res.status(403).json({ error: err.message, code: err.code })
    }
    logger.error({ err, matchId: req.params.id }, 'POST /rt/tournaments/matches/:id/table failed')
    return res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/v1/rt/tables/:tableId/watch
//
// Replaces `socket.emit('table:watch', { tableId, authToken })` for clients
// on the SSE+POST transport. Adds the SSE session as a watcher of the
// given Table, fires the spectator.joined cohort dispatch (when newly
// authenticated), starts the demo Hook step-2 credit timer for demo tables,
// and broadcasts updated presence on `table:<id>:presence` (and the legacy
// Socket.io `table:presence` channel via dualEmitPresence).
//
// Returns 200 + { tableId, count, userIds } on success, 404 if the table
// doesn't exist. Idempotent — re-watching from the same session is a no-op
// for the cohort/demo side-effects.
router.post('/tables/:tableId/watch', async (req, res) => {
  try {
    const { tableId } = req.params
    const { sessionId } = req.sseSession

    const table = await db.table.findUnique({
      where:  { id: tableId },
      select: { id: true },
    })
    if (!table) return res.status(404).json({ error: 'Table not found' })

    const appUser = req.auth?.userId
      ? await db.user.findUnique({
          where:  { betterAuthId: req.auth.userId },
          select: { id: true, displayName: true, username: true },
        })
      : null

    await watchForSession({ tableId, sessionId, user: appUser })

    // Track in the session record so dispose-time cleanup knows what to
    // remove + rebroadcast for.
    const sseSessions = await import('../realtime/sseSessions.js')
    sseSessions.joinTable(sessionId, tableId)

    // Rebroadcast presence on both transports. The spectator-count side of
    // the payload is socket-only state for now (`_spectatorSockets` lives
    // in socketHandler), so we pass 0 — the Socket.io legacy emit on the
    // socket path already carries the right number for socket clients.
    const presence = getTablePresence(tableId)
    const io = req.app.get('io')
    dualEmitPresence(io, tableId, presence, 0)

    return res.json({ tableId, ...presence })
  } catch (err) {
    logger.error({ err, tableId: req.params.tableId }, 'POST /rt/tables/:tableId/watch failed')
    return res.status(500).json({ error: 'Internal error' })
  }
})

// DELETE /api/v1/rt/tables/:tableId/watch
//
// Counterpart to POST /watch. Removes this SSE session from the watcher
// list, clears any pending demo timer, and rebroadcasts presence so the
// badge count drops immediately (instead of waiting for the SSE session
// to dispose entirely).
router.delete('/tables/:tableId/watch', async (req, res) => {
  try {
    const { tableId } = req.params
    const { sessionId } = req.sseSession

    const { removed } = unwatchForSession({ tableId, sessionId })

    const sseSessions = await import('../realtime/sseSessions.js')
    sseSessions.leaveTable(sessionId, tableId)

    if (removed) {
      const presence = getTablePresence(tableId)
      const io = req.app.get('io')
      dualEmitPresence(io, tableId, presence, 0)
    }

    return res.json({ tableId, removed })
  } catch (err) {
    logger.error({ err, tableId: req.params.tableId }, 'DELETE /rt/tables/:tableId/watch failed')
    return res.status(500).json({ error: 'Internal error' })
  }
})

// ── Pong (Phase 6) ───────────────────────────────────────────────────────────
//
// SSE+POST counterparts to the legacy `pong:create` / `pong:join` / `pong:input`
// socket emits. The runner accepts an opaque participant id; for the SSE
// transport that id is the sseSessionId (no collision with socket.id).

// POST /api/v1/rt/pong/rooms { slug }  → { slug, playerIndex }
//
// Creates the room (idempotent — re-creating an existing slug is a no-op)
// and seats the caller as the first available player.
router.post('/pong/rooms', async (req, res) => {
  try {
    const { slug } = req.body ?? {}
    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({ error: 'slug required' })
    }
    const { sessionId } = req.sseSession
    pongRunner.createRoom(slug)
    const result = pongRunner.joinRoom(slug, sessionId)
    if (result.error) return res.status(404).json({ error: result.error })
    sseSessions.joinPongRoom(sessionId, slug)
    return res.json({ slug, playerIndex: result.playerIndex })
  } catch (err) {
    logger.error({ err }, 'POST /rt/pong/rooms failed')
    return res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/v1/rt/pong/rooms/:slug/join  → { slug, playerIndex, spectating, state }
//
// Joins an existing room (or creates it on demand, matching the legacy
// `pong:join` semantics). The caller may end up as P2 or, if both seats
// are taken, as a spectator. `state` is the current game state so a late
// arrival can render immediately without waiting for the next tick.
router.post('/pong/rooms/:slug/join', async (req, res) => {
  try {
    const { slug } = req.params
    const { sessionId } = req.sseSession
    if (!pongRunner.hasRoom(slug)) pongRunner.createRoom(slug)
    const result = pongRunner.joinRoom(slug, sessionId)
    if (result.error) return res.status(404).json({ error: result.error })
    sseSessions.joinPongRoom(sessionId, slug)
    return res.json({
      slug,
      playerIndex: result.playerIndex ?? null,
      spectating:  result.spectating ?? false,
      state:       pongRunner.getState(slug),
    })
  } catch (err) {
    logger.error({ err, slug: req.params.slug }, 'POST /rt/pong/rooms/:slug/join failed')
    return res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/v1/rt/pong/rooms/:slug/input { direction }
//
// Replaces the per-keyframe `pong:input` socket emit. Body is { direction:
// 'up' | 'down' | 'stop' }. Returns 204 — the next tick over the SSE
// `pong:<slug>:state` channel reflects the change.
router.post('/pong/rooms/:slug/input', async (req, res) => {
  try {
    const { slug } = req.params
    const { direction } = req.body ?? {}
    if (!direction) return res.status(400).json({ error: 'direction required' })
    const { sessionId } = req.sseSession
    pongRunner.applyInput(slug, sessionId, direction)
    return res.status(204).end()
  } catch (err) {
    logger.error({ err, slug: req.params.slug }, 'POST /rt/pong/rooms/:slug/input failed')
    return res.status(500).json({ error: 'Internal error' })
  }
})

// ── Tables / game flow (Phase 7c) ────────────────────────────────────────────
//
// SSE+POST counterparts to the legacy `room:create`, `room:join`, `room:cancel`,
// `game:move`, `game:forfeit`, `game:leave`, `game:rematch`, `game:reaction`
// socket emits. Each route resolves the calling identity (signed-in user via
// req.auth, or a guest seat keyed by sseSessionId), looks up the table by
// slug, then calls into tableFlowService — the same service the socket
// handler delegates to. Both transports share one source of truth.
//
// Channels written here:
//   - `table:<id>:state`     — game:start, game:moved, game:forfeit
//   - `table:<id>:lifecycle` — room:cancelled, room:guestJoined, etc. (most
//                              of these are emitted from inside the service)
//   - `table:<id>:reaction`  — emoji
//   - `user:<userId>:table:created` — personal one-shot when a user creates a
//                              table (signed-in users only; guests get the
//                              same data in the HTTP response).

/** Resolve the calling identity for a /rt/tables/* route. Always returns a
 *  `seatId` — `betterAuthId` for signed-in users, `guest:<sessionId>` for
 *  guests so the seats blob can disambiguate concurrent guest games. */
async function resolveCaller(req) {
  const sessionId = req.sseSession.sessionId
  if (req.auth?.userId) {
    const user = await db.user.findUnique({
      where:  { betterAuthId: req.auth.userId },
      select: { id: true, betterAuthId: true, displayName: true },
    })
    if (user) {
      return {
        sessionId,
        user,
        seatId:    user.betterAuthId,
        domainId:  user.id,
        isGuest:   false,
      }
    }
  }
  return {
    sessionId,
    user:     null,
    seatId:   `guest:${sessionId}`,
    domainId: null,
    isGuest:  true,
  }
}

// POST /api/v1/rt/tables
//
// Body: { kind: 'pvp'|'hvb', botUserId?, spectatorAllowed?,
//         tournamentMatchId? }
//
// Replaces socket emits `room:create` (PvP) and `room:create:hvb` (HvB).
// Returns 200 + { slug, label, mark, action?, board?, currentTurn? }; HvB
// adds board/currentTurn so the client can render the opening position
// without an extra GET. Tournament rejoin/rematch-in-place set `action` to
// `'rejoined' | 'rematched'`; brand-new creates set it to `'created'`.
//
// Phase 3.8.5.2 — picker payload carries only `botId`; the skill is
// resolved server-side from `(botId, gameId)` in tableFlowService.
// Any incoming `botSkillId` is silently ignored.
router.post('/tables', async (req, res) => {
  try {
    const {
      kind,
      botUserId,
      spectatorAllowed  = true,
      tournamentMatchId = null,
    } = req.body ?? {}
    if (kind !== 'pvp' && kind !== 'hvb') {
      return res.status(400).json({ error: 'kind must be pvp or hvb' })
    }
    const caller = await resolveCaller(req)
    const io = req.app.get('io')

    let result
    if (kind === 'pvp') {
      result = await tableFlow.createPvpTable({
        user:    caller.user,
        seatId:  caller.seatId,
        spectatorAllowed,
      })
    } else {
      if (!botUserId) return res.status(400).json({ error: 'botUserId required' })
      result = await tableFlow.createHvbTable({
        user:              caller.user,
        seatId:            caller.seatId,
        botUserId,
        spectatorAllowed,
        tournamentMatchId,
      })
    }

    if (!result.ok) {
      const status = result.code === 'BOT_NOT_FOUND' ? 404 : 400
      return res.status(status).json({ error: result.message ?? 'Bad request', code: result.code })
    }

    // Track the table on the SSE session so disconnect handling (Phase 7e)
    // can fire a forfeit timer against the right table.
    sseSessions.joinTable(caller.sessionId, result.table.id)

    // Personal one-shot for second-tab listeners. The HTTP response carries
    // the same data, so guests don't need this — and the channel is keyed
    // by domain userId, which guests don't have.
    if (caller.domainId) {
      appendToStream(
        `user:${caller.domainId}:table:created`,
        {
          slug:   result.slug,
          label:  result.label,
          mark:   result.mark,
          kind,
          action: result.action ?? 'created',
        },
        { userId: caller.domainId },
      ).catch(() => {})
    }

    // HvB rematch-in-place may need the bot's opening move dispatched. The
    // service flagged `botOpeningPending` rather than firing it directly so
    // the caller (us) can do it after the io is in scope.
    if (result.botOpeningPending) {
      const sh = await import('../realtime/socketHandler.js')
      sh.dispatchBotMove(result.table, io).catch(err =>
        logger.warn({ err }, 'Failed to dispatch bot opening on rt rematch-in-place'),
      )
    }

    return res.json({
      slug:        result.slug,
      label:       result.label,
      mark:        result.mark,
      action:      result.action ?? 'created',
      ...(result.board       !== undefined ? { board:       result.board       } : {}),
      ...(result.currentTurn !== undefined ? { currentTurn: result.currentTurn } : {}),
    })
  } catch (err) {
    logger.error({ err }, 'POST /rt/tables failed')
    return res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/v1/rt/tables/:slug/join
//
// Body: { role?: 'player' | 'spectator' } (default 'player')
//
// Replaces the socket `room:join` emit. The service decides which join path
// applies (host reattach, creator seating, guest seating, ACTIVE re-attach,
// or spectator) and lifecycle/start broadcasts go out from inside the service.
router.post('/tables/:slug/join', async (req, res) => {
  try {
    const { slug } = req.params
    const role = req.body?.role === 'spectator' ? 'spectator' : 'player'
    const caller = await resolveCaller(req)
    const io = req.app.get('io')

    const result = await tableFlow.joinTable({
      io,
      user:   caller.user,
      seatId: caller.seatId,
      slug,
      role,
    })

    if (!result.ok) {
      const map = {
        TABLE_NOT_FOUND: 404,
        ROOM_FULL:       409,
        PRIVATE_TABLE:   403,
        AUTH_REQUIRED:   401,
        BAD_REQUEST:     400,
      }
      return res.status(map[result.code] ?? 400).json({ error: result.message, code: result.code })
    }

    // Track the table on the session for disconnect/cleanup.
    if (result.table?.id) sseSessions.joinTable(caller.sessionId, result.table.id)

    // Phase 7e: a re-attach (host_reattach / reattached_active) means the user
    // is back from a disconnect. Cancel any pending forfeit timer keyed by
    // their seat at this table — mirrors the socket handler clearing
    // `_disconnectTimers` on a successful tryReconnect.
    if (
      result.table?.id
      && (result.action === 'host_reattach' || result.action === 'reattached_active')
    ) {
      cancelForfeitFor({ seatId: caller.seatId, tableId: result.table.id })
    }

    return res.json({
      action: result.action,
      mark:   result.mark ?? null,
      slug,
      tableId: result.table?.id,
      ...(result.room         ? { room:         result.room         } : {}),
      ...(result.startPayload ? { startPayload: result.startPayload } : {}),
    })
  } catch (err) {
    logger.error({ err, slug: req.params.slug }, 'POST /rt/tables/:slug/join failed')
    return res.status(500).json({ error: 'Internal error' })
  }
})

/** Internal: resolve { tableId, seatId, callerUserId } from slug + session. */
async function lookupTableForCaller(req) {
  const { slug } = req.params
  const caller = await resolveCaller(req)
  const table = await db.table.findFirst({ where: { slug }, select: { id: true } })
  return { caller, table, slug }
}

// POST /api/v1/rt/tables/:slug/cancel
router.post('/tables/:slug/cancel', async (req, res) => {
  try {
    const { caller, table } = await lookupTableForCaller(req)
    if (!table) return res.status(404).json({ error: 'Table not found' })
    const io = req.app.get('io')
    const result = await tableFlow.cancelTable({ io, tableId: table.id })
    if (!result.ok) return res.status(400).json({ error: result.code })
    sseSessions.leaveTable(caller.sessionId, table.id)
    return res.json({ ok: true })
  } catch (err) {
    logger.error({ err, slug: req.params.slug }, 'POST /rt/tables/:slug/cancel failed')
    return res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/v1/rt/tables/:slug/move  Body: { cellIndex }
router.post('/tables/:slug/move', async (req, res) => {
  // F4 perf decomposition: emit Server-Timing so perf-sse-rtt can split the
  // POST round-trip into lookup vs apply vs network. Cheap (Date.now × 3).
  const t0 = Date.now()
  try {
    const { cellIndex } = req.body ?? {}
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex > 8) {
      return res.status(400).json({ error: 'cellIndex must be an integer 0..8' })
    }
    const { caller, table } = await lookupTableForCaller(req)
    if (!table) return res.status(404).json({ error: 'Table not found' })
    const t1 = Date.now()
    const io = req.app.get('io')
    const result = await tableFlow.applyMove({
      io,
      tableId: table.id,
      userId:  caller.seatId,
      cellIndex,
    })
    const t2 = Date.now()
    if (!result.ok) {
      const map = {
        NOT_IN_TABLE:     409,
        TABLE_NOT_FOUND:  404,
        NOT_ACTIVE:       410,
        NOT_A_PLAYER:     403,
        NOT_YOUR_TURN:    409,
        CELL_OCCUPIED:    409,
      }
      return res.status(map[result.code] ?? 400).json({ error: result.message, code: result.code })
    }
    // Reset the idle warn/forfeit timer for this player. A move proves the
    // player is present even if their visibilitychange/focus pong missed.
    // For COMPLETED games (final move just landed) `cancelAllForTable`
    // below clears both seats so neither player gets a stray idle:warn.
    if (caller.domainId) {
      if (result.completed) {
        idleTimers.cancelAllForTable(table.id)
      } else {
        idleTimers.arm({ userId: caller.domainId, tableId: table.id, slug: req.params.slug, io }).catch(() => {})
      }
    } else if (result.completed) {
      idleTimers.cancelAllForTable(table.id)
    }
    res.set('Server-Timing', `lookup;dur=${t1 - t0}, apply;dur=${t2 - t1}`)
    return res.json({ ok: true, completed: !!result.completed, mark: result.mark })
  } catch (err) {
    logger.error({ err, slug: req.params.slug }, 'POST /rt/tables/:slug/move failed')
    return res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/v1/rt/tables/:slug/forfeit
router.post('/tables/:slug/forfeit', async (req, res) => {
  try {
    const { caller, table } = await lookupTableForCaller(req)
    if (!table) return res.status(404).json({ error: 'Table not found' })
    const io = req.app.get('io')
    const result = await tableFlow.forfeitGame({ io, tableId: table.id, userId: caller.seatId })
    if (!result.ok) {
      const map = { NOT_IN_TABLE: 409, TABLE_NOT_FOUND: 404, NOT_A_PLAYER: 403 }
      return res.status(map[result.code] ?? 400).json({ error: result.code })
    }
    sseSessions.leaveTable(caller.sessionId, table.id)
    idleTimers.cancelAllForTable(table.id)
    return res.json({ ok: true, mark: result.mark, oppMark: result.oppMark })
  } catch (err) {
    logger.error({ err, slug: req.params.slug }, 'POST /rt/tables/:slug/forfeit failed')
    return res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/v1/rt/tables/:slug/leave
//
// Player leaves a finished game. Frees their seat and notifies the rest of
// the table (`game:opponent_left`).
router.post('/tables/:slug/leave', async (req, res) => {
  try {
    const { caller, table } = await lookupTableForCaller(req)
    if (!table) return res.status(404).json({ error: 'Table not found' })
    const io = req.app.get('io')
    const result = await tableFlow.leaveGame({ io, tableId: table.id, userId: caller.seatId })
    if (!result.ok) {
      const map = { NOT_IN_TABLE: 409, TABLE_NOT_FOUND: 404, NOT_A_PLAYER: 403 }
      return res.status(map[result.code] ?? 400).json({ error: result.code })
    }
    sseSessions.leaveTable(caller.sessionId, table.id)
    if (caller.domainId) idleTimers.cancel({ userId: caller.domainId, tableId: table.id })
    return res.json({ ok: true })
  } catch (err) {
    logger.error({ err, slug: req.params.slug }, 'POST /rt/tables/:slug/leave failed')
    return res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/v1/rt/tables/:slug/rematch
router.post('/tables/:slug/rematch', async (req, res) => {
  try {
    const { table } = await lookupTableForCaller(req)
    if (!table) return res.status(404).json({ error: 'Table not found' })
    const io = req.app.get('io')
    const result = await tableFlow.rematchGame({ io, tableId: table.id })
    if (!result.ok) {
      const map = { NOT_IN_TABLE: 409, TABLE_NOT_FOUND: 404, NOT_COMPLETED: 409 }
      return res.status(map[result.code] ?? 400).json({ error: result.message, code: result.code })
    }
    return res.json({ ok: true, round: result.previewState.round, scores: result.previewState.scores })
  } catch (err) {
    logger.error({ err, slug: req.params.slug }, 'POST /rt/tables/:slug/rematch failed')
    return res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/v1/rt/tables/:slug/reaction  Body: { emoji }
router.post('/tables/:slug/reaction', async (req, res) => {
  try {
    const { emoji } = req.body ?? {}
    if (!emoji || typeof emoji !== 'string') {
      return res.status(400).json({ error: 'emoji required' })
    }
    const { caller, table } = await lookupTableForCaller(req)
    if (!table) return res.status(404).json({ error: 'Table not found' })
    const io = req.app.get('io')
    const result = await tableFlow.sendReaction({
      io,
      tableId: table.id,
      userId:  caller.seatId,
      emoji,
    })
    if (!result.ok) {
      const map = { INVALID_EMOJI: 400, TABLE_NOT_FOUND: 404, NOT_IN_TABLE: 409 }
      return res.status(map[result.code] ?? 400).json({ error: result.code })
    }
    return res.json({ ok: true })
  } catch (err) {
    logger.error({ err, slug: req.params.slug }, 'POST /rt/tables/:slug/reaction failed')
    return res.status(500).json({ error: 'Internal error' })
  }
})

export default router
