// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * /api/v1/rt — client → server side of the SSE+POST transport.
 *
 * This router is the home for every POST that used to be a Socket.io
 * `socket.emit(...)` in the legacy transport. Each route resolves the user
 * via requireAuth and the live SSE connection via requireSseSession (the
 * `X-SSE-Session` header), then calls into the same service code the
 * Socket.io handlers used to call.
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
import { requireAuth } from '../middleware/auth.js'
import * as sseSessions from '../realtime/sseSessions.js'
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

// All /rt/* routes are authenticated and require a live SSE session.
// Phase 1+ mount handlers below.
router.use(requireAuth, requireSseSession)

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
    if (result.ok) return res.json({ ok: true })
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

export default router
