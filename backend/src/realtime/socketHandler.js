// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Socket.io event handler — Phase 3.4.
 * All game state is persisted in the DB `Table` model (previewState JSON column).
 * A thin in-memory `_socketToTable` map provides fast socket→tableId lookup for
 * disconnect handling. No other game state lives in memory.
 */

import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import Redis from 'ioredis'
import { jwtVerify, importJWK } from 'jose'
import { botGameRunner } from './botGameRunner.js'
import * as pongRunner from './pongRunner.js'
import { getUserByBetterAuthId, createGame } from '../services/userService.js'
import db from '../lib/db.js'
import { updatePlayersEloAfterPvP } from '../services/eloService.js'
import { getSystemConfig, getMoveForModel, resolveSkillForGame } from '../services/skillService.js'
import { minimaxMove, getWinner, isBoardFull, WIN_LINES } from '@xo-arena/ai'
import { recordActivity } from '../services/activityService.js'
import { recordGameCompletion } from '../services/creditService.js'
import { completeStep as completeJourneyStep } from '../services/journeyService.js'
import { deletePendingPvpMatch } from '../lib/tournamentBridge.js'
import { joinMatchTable, TournamentMatchError } from '../services/tournamentMatchService.js'
import {
  incrementSocket, decrementSocket,
  incrementRedis, decrementRedis,
  trackedOn, startSnapshotInterval,
} from '../lib/resourceCounters.js'
import {
  addWatcher as addTableWatcher,
  removeWatcher as removeTableWatcher,
  removeWatcherFromAllTables,
  removeAllWatchersForTable,
  getPresence as getTablePresence,
} from './tablePresence.js'
import { dispatch as dispatchBus } from '../lib/notificationBus.js'
import { appendToStream } from '../lib/eventStream.js'
import {
  dualEmitPresence,
  dualEmitLifecycle,
} from '../services/tablePresenceService.js'
import { nanoid } from 'nanoid'
import { formatTableLabel } from '../lib/tableLabel.js'
import { createTableTracked } from '../lib/createTableTracked.js'
import { releaseSeats, releaseSeatForUser } from '../lib/tableSeats.js'
import { dispatchTableReleased, TABLE_RELEASED_REASONS } from '../lib/tableReleased.js'
import logger from '../logger.js'

const TOURNAMENT_SERVICE_URL = process.env.TOURNAMENT_SERVICE_URL || 'http://localhost:3001'

// ── In-memory maps ────────────────────────────────────────────────────────────
// socketId → tableId  (thin lookup for disconnect handling — NO game state)
const _socketToTable = new Map()
// socketId → userId   (which user a socket belongs to — for mark resolution)
const _socketToUser = new Map()
// socketId → { tableId, timerId }  (disconnect forfeit timers)
const _disconnectTimers = new Map()
// socketId → timerId  (idle timers — phase 1 warn + phase 2 abandon/kick)
const _idleTimers = new Map()
// socketId → tableId  (spectators only — tracked independently from table:watch
// presence so the count is correct even when players join via /play?join=slug
// and never emit table:watch)
const _spectatorSockets = new Map()
// socketId → Map<tableId, NodeJS.Timeout>  (Demo Table macro §5.1 — 2-min
// step-2 credit timers; cleared on unwatch / disconnect / earlier completion)
const _demoWatchTimers = new Map()
const DEMO_WATCH_THRESHOLD_MS = 2 * 60 * 1000  // 2 min

// Tracks which socket.io adapter backed io on this process: 'redis' if the
// Redis pub/sub adapter attached cleanly at boot, 'in-memory' if it fell
// back. Surfaced via /api/v1/admin/health/tables so the admin dashboard can
// see the degraded-but-running state instead of having it hide in a single
// WARN line on stdout.
let _socketAdapterState = 'unknown'

/** Read the current socket.io adapter state ('redis' | 'in-memory' | 'unknown'). */
export function getSocketAdapterState() {
  return _socketAdapterState
}

function _clearDemoTimer(socketId, tableId) {
  const m = _demoWatchTimers.get(socketId)
  if (!m) return
  const t = m.get(tableId)
  if (t) {
    clearTimeout(t)
    m.delete(tableId)
  }
  if (m.size === 0) _demoWatchTimers.delete(socketId)
}

function _clearAllDemoTimers(socketId) {
  const m = _demoWatchTimers.get(socketId)
  if (!m) return
  for (const t of m.values()) clearTimeout(t)
  _demoWatchTimers.delete(socketId)
}

/** Register a socket→table mapping and track the userId. */
function registerSocket(socketId, tableId, userId) {
  _socketToTable.set(socketId, tableId)
  if (userId) _socketToUser.set(socketId, userId)
}

/** Unregister a socket from all in-memory maps. */
function unregisterSocket(socketId) {
  _socketToTable.delete(socketId)
  _socketToUser.delete(socketId)
}

/**
 * Find the userId for a given socket in a given table.
 * Uses the _socketToUser map, falling back to single-occupied-seat heuristic.
 */
function findUserIdForSocket(socketId, tableId, seats) {
  const cached = _socketToUser.get(socketId)
  if (cached) return cached
  const occupied = seats.filter(s => s.status === 'occupied' && s.userId)
  if (occupied.length === 1) return occupied[0].userId
  return null
}

// ── Table presence / disconnect ──────────────────────────────────────────────
// Online-users presence now lives in presenceStore.js (heartbeat-based) and is
// exposed via /api/v1/presence/online + the presence:changed SSE channel. The
// disconnect-forfeit timer below still uses RECONNECT_WINDOW_MS for gameplay.
const RECONNECT_WINDOW_MS = 60_000

function getSpectatorCount(tableId) {
  let count = 0
  for (const [, tid] of _spectatorSockets) {
    if (tid === tableId) count++
  }
  return count
}

function broadcastTablePresence(io, tableId) {
  // Phase 5 dual-emit: `table:presence` over Socket.io (legacy) AND a
  // matching SSE append on the `table:<id>:presence` channel. Both
  // transports see the same payload; clients select via `viaSse('tables')`.
  const presence = getTablePresence(tableId)
  const spectatingCount = getSpectatorCount(tableId)
  dualEmitPresence(io, tableId, presence, spectatingCount)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a fresh previewState blob. */
function makePreviewState({ marks, botMark = null }) {
  return {
    board: Array(9).fill(null),
    currentTurn: 'X',
    scores: { X: 0, O: 0 },
    round: 1,
    winner: null,
    winLine: null,
    marks,     // { [userId]: 'X'|'O' }
    botMark,   // 'O' for HvB, null for PvP
    moves: [],
  }
}

/** Build the sanitised room payload the frontend expects from room:joined / room:guestJoined. */
function sanitizeTable(table, extras = {}) {
  const ps = table.previewState || {}
  const seats = table.seats || []
  const spectatorCount = 0 // spectator count not tracked in DB seats
  return {
    slug: table.slug,
    label: formatTableLabel(table, extras.viewerId ?? null),
    isHvb: !!table.isHvb,
    isDemo: !!table.isDemo,
    isTournament: !!table.isTournament,
    status: mapStatus(table.status),
    board: ps.board ?? Array(9).fill(null),
    currentTurn: ps.currentTurn ?? 'X',
    scores: ps.scores ?? { X: 0, O: 0 },
    round: ps.round ?? 1,
    winner: ps.winner ?? null,
    winLine: ps.winLine ?? null,
    spectatorCount,
    spectatorAllowed: !table.isPrivate,
    // userId fields are betterAuthId — matches session.user.id on the frontend
    hostUserId: seats[0]?.userId ?? null,
    hostUserDisplayName: extras.hostUserDisplayName ?? seats[0]?.displayName ?? null,
    hostUserElo: extras.hostUserElo ?? null,
    guestUserId: seats[1]?.userId ?? null,
    guestUserDisplayName: extras.guestUserDisplayName ?? seats[1]?.displayName ?? null,
    guestUserElo: extras.guestUserElo ?? null,
  }
}

/** Map DB TableStatus to the frontend's status string. */
function mapStatus(dbStatus) {
  switch (dbStatus) {
    case 'FORMING':   return 'waiting'
    case 'ACTIVE':    return 'playing'
    case 'COMPLETED': return 'finished'
    default:          return dbStatus
  }
}

/** Map frontend status back to DB TableStatus. */
function toDbStatus(frontendStatus) {
  switch (frontendStatus) {
    case 'waiting':  return 'FORMING'
    case 'playing':  return 'ACTIVE'
    case 'finished': return 'COMPLETED'
    default:         return frontendStatus
  }
}

/** Find userId for a seat by mark from previewState.marks. */
function userIdForMark(marks, mark) {
  if (!marks) return null
  return Object.entries(marks).find(([, m]) => m === mark)?.[0] ?? null
}

/** Get the userId of the "host" (X player) from seats. */
function hostUserId(seats) {
  return seats?.[0]?.userId ?? null
}

/** Get the userId of the "guest" (O player) from seats. */
function guestUserId(seats) {
  return seats?.[1]?.userId ?? null
}

/**
 * Report a completed tournament match to the tournament service.
 */
async function completeTournamentMatch(matchId, winnerId, p1Wins, p2Wins, drawGames) {
  try {
    const res = await fetch(`${TOURNAMENT_SERVICE_URL}/api/matches/${matchId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.INTERNAL_SECRET ? { 'x-internal-secret': process.env.INTERNAL_SECRET } : {}),
      },
      body: JSON.stringify({ winnerId, p1Wins, p2Wins, drawGames }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      logger.error({ matchId, status: res.status, body }, 'completeTournamentMatch: non-2xx response')
      return false
    }
    return true
  } catch (err) {
    logger.error({ err, matchId }, 'completeTournamentMatch: fetch failed')
    return false
  }
}

const ALLOWED_REACTIONS = ['👍', '😂', '😮', '🔥', '😭', '🤔', '👏', '💀']

async function getIdleConfig() {
  const [warnSec, graceSec, spectatorSec] = await Promise.all([
    getSystemConfig('game.idleWarnSeconds',      120),
    getSystemConfig('game.idleGraceSeconds',      60),
    getSystemConfig('game.spectatorIdleSeconds', 600),
  ])
  return {
    warnMs:      warnSec      * 1000,
    graceMs:     graceSec     * 1000,
    spectatorMs: spectatorSec * 1000,
  }
}

function makeIdleCallbacks(io) {
  return {
    onWarn: ({ socketId, graceMs }) => {
      const secondsRemaining = Math.round(graceMs / 1000)
      io.to(socketId).emit('idle:warning', { secondsRemaining })

      // Also publish onto the SSE stream so clients on the SSE+POST transport
      // (or in dual mode) receive the warning. We address it to the user, not
      // the socket, because SSE has no socket.id concept — sseBroker filters
      // personal events by userId. Lookup is best-effort: if the socket has
      // already gone away, skip the publish (the socket emit above is the
      // canonical legacy path).
      const userId = _socketToUser.get(socketId)
      if (userId) {
        appendToStream(
          `user:${userId}:idle`,
          { kind: 'warning', secondsRemaining },
          { userId },
        ).catch(() => {})
      }
    },
    onAbandon: ({ absentSocketId, absentUserId, tableId }) => {
      // Phase 5 dual-emit: legacy `room:abandoned` to socket room + SSE
      // lifecycle channel for clients on the SSE+POST transport.
      dualEmitLifecycle(io, tableId, 'abandoned', { reason: 'idle', absentUserId })
      dispatchBus({ type: 'table.completed', targets: { broadcast: true }, payload: { tableId } })
        .catch(() => {})
    },
    onKick: ({ socketId }) => {
      // `room:kicked` is targeted at a single socket. SSE has no per-socket
      // address, so the SSE counterpart goes onto the user's personal
      // channel. Resolve the userId via the in-memory map; if it's gone,
      // skip the SSE side (the socket emit still fires below).
      io.to(socketId).emit('room:kicked', { reason: 'idle' })
      const userId = _socketToUser.get(socketId)
      if (userId) {
        appendToStream(
          `user:${userId}:room:kicked`,
          { reason: 'idle' },
          { userId },
        ).catch(() => {})
      }
    },
  }
}

/**
 * Reset the idle timer for a given (userId, tableId) pair using the socket-
 * keyed machinery in this module. Called by the SSE+POST `idle/pong` route
 * and the legacy socket `idle:pong` handler so both transports share the
 * exact same reset behavior.
 *
 * Returns one of:
 *   { ok: true, isPlayer }                — timer reset
 *   { ok: false, reason: 'no-session' }    — user is not connected to this table
 *   { ok: false, reason: 'not-active' }    — table is not ACTIVE
 *   { ok: false, reason: 'not-found' }     — table does not exist
 */
export async function resetIdleForUserInTable(io, userId, tableId) {
  if (!io || !userId || !tableId) return { ok: false, reason: 'no-session' }

  const table = await db.table.findUnique({ where: { id: tableId } })
  if (!table) return { ok: false, reason: 'not-found' }
  if (table.status !== 'ACTIVE') return { ok: false, reason: 'not-active' }

  // Find the user's socket(s) at this table. Same user can have multiple tabs
  // — reset the timer for each so a refresh in any one keeps them all alive.
  const sockets = []
  for (const [sid, uid] of _socketToUser) {
    if (uid === userId && _socketToTable.get(sid) === tableId) sockets.push(sid)
  }
  if (sockets.length === 0) return { ok: false, reason: 'no-session' }

  const seats = table.seats || []
  const isPlayer = seats.some(s => s.userId === userId && s.status === 'occupied')
  const { warnMs, graceMs, spectatorMs } = await getIdleConfig()
  const { onWarn, onAbandon, onKick } = makeIdleCallbacks(io)

  for (const sid of sockets) {
    resetIdleTimer({
      socketId: sid,
      tableId,
      isPlayer,
      warnMs: isPlayer ? warnMs : spectatorMs,
      graceMs,
      onWarn,
      onAbandon,
      onKick,
    })
  }
  return { ok: true, isPlayer }
}

/**
 * Reset (or start) the 2-phase idle timer for a single socket.
 * Phase 1: warn after warnMs.  Phase 2: abandon/kick after graceMs.
 */
function resetIdleTimer({ socketId, tableId, isPlayer, warnMs, graceMs, onWarn, onAbandon, onKick }) {
  clearIdleTimer(socketId)

  const phase1 = setTimeout(() => {
    onWarn?.({ socketId, graceMs })

    const phase2 = setTimeout(async () => {
      _idleTimers.delete(socketId)
      if (isPlayer) {
        // Look up userId before marking COMPLETED
        try {
          const table = await db.table.findUnique({ where: { id: tableId }, select: { seats: true, tournamentMatchId: true } })
          const seat = table?.seats?.find(s => _socketToTable.get(socketId) === tableId)
          const absentUserId = seat?.userId ?? null
          // Mark table COMPLETED + free seats
          await db.table.update({
            where: { id: tableId },
            data:  { status: 'COMPLETED', seats: releaseSeats(table?.seats) },
          }).catch(() => {})
          dispatchTableReleased(tableId, TABLE_RELEASED_REASONS.DISCONNECT, { trigger: 'idle-abandon' })
          if (table?.tournamentMatchId) deletePendingPvpMatch(table.tournamentMatchId)
          await deleteIfGuestTable(tableId)
        } catch (_) { /* best effort */ }
        unregisterSocket(socketId)
        onAbandon?.({ absentSocketId: socketId, absentUserId: null, tableId })
      } else {
        unregisterSocket(socketId)
        onKick?.({ socketId })
      }
    }, graceMs)

    _idleTimers.set(socketId, phase2)
  }, warnMs)

  _idleTimers.set(socketId, phase1)
}

function clearIdleTimer(socketId) {
  const t = _idleTimers.get(socketId)
  if (t) {
    clearTimeout(t)
    _idleTimers.delete(socketId)
  }
}

/** Clear all idle timers for sockets pointing at a given table. */
function clearAllIdleTimersForTable(tableId) {
  for (const [sid, _] of _socketToTable) {
    if (_socketToTable.get(sid) === tableId) {
      clearIdleTimer(sid)
    }
  }
}

/**
 * Drop every in-memory pointer at a given tableId — chunk 3 F4/F5.
 *
 * GC sweeps and admin DELETE used to flip `Table.status` (or delete the row)
 * but leave `_socketToTable`, `_disconnectTimers`, `_idleTimers`,
 * `_spectatorSockets`, `_demoWatchTimers`, and the watcher map all pointing
 * at the dead row. The maps then held stale entries until the next disconnect
 * fired, which is why a stuck process accumulated orphan timers + sockets.
 *
 * Idempotent and safe to call from any caller — this is the single point of
 * cleanup the GC + admin paths can hit. Returns the list of sockets that were
 * pointing at the table so the caller can decide whether to broadcast presence
 * (the row is gone, so usually they shouldn't).
 */
export function unregisterTable(tableId) {
  if (!tableId) return []

  // Snapshot every socket that referenced this table — players + spectators.
  const affectedSockets = new Set()
  for (const [sid, tid] of _socketToTable) {
    if (tid === tableId) affectedSockets.add(sid)
  }
  for (const [sid, tid] of _spectatorSockets) {
    if (tid === tableId) affectedSockets.add(sid)
  }

  for (const sid of affectedSockets) {
    clearIdleTimer(sid)
    _spectatorSockets.delete(sid)
    _clearAllDemoTimers(sid)
    unregisterSocket(sid)
  }

  // Disconnect timers are keyed by the *original* socketId (which has since
  // gone away) but carry the tableId in their value — sweep by tableId.
  for (const [sid, info] of _disconnectTimers) {
    if (info?.tableId === tableId) {
      clearTimeout(info.timerId)
      _disconnectTimers.delete(sid)
    }
  }

  // Drop watchers for this table — the table:watch presence map must agree.
  removeAllWatchersForTable(tableId)

  return [...affectedSockets]
}

/**
 * If a table was created by an unauthenticated guest, delete the row.
 *
 * Guest tables (createdById === 'anonymous') are ephemeral — they exist only
 * to give the realtime layer a single primitive to hang a game on. Once the
 * game ends there's no Game record to join back to (recordPvpGame skips all-
 * guest tables), no ELO impact, and no value in keeping the row around. Not
 * deleting them clutters the DB and shows up in "mine"/admin views.
 *
 * Timing rule (chunk 3 P2 — guest-table deletion):
 *   - `game:move` natural game-end: deletion is **deferred**. The player
 *     is still at the table waiting on Rematch, and the row must survive
 *     until the socket actually disconnects. The disconnect-after-COMPLETED
 *     branch then calls this helper.
 *   - `game:forfeit` / `room:cancel` / `disconnect 60-s timer`: deletion is
 *     **immediate**. The forfeiter / canceller is leaving by intent (or has
 *     stopped responding); no Rematch path is reachable, so keeping the row
 *     just delays the inevitable cleanup.
 *   - 24-h `tableGcService` sweep is the backstop in case neither path runs.
 * Document this here rather than at every call site so future readers don't
 * have to reverse-engineer the pattern from the inventory.
 *
 * Accepts either a tableId string or a partial table object with
 * `{ id, createdById }` — the latter skips the extra lookup when the caller
 * already has the row in memory. Always best-effort; logs and swallows
 * errors so this can't break the surrounding completion flow.
 */
async function deleteIfGuestTable(tableOrId) {
  try {
    let tableId, createdById
    if (typeof tableOrId === 'string') {
      const t = await db.table.findUnique({
        where:  { id: tableOrId },
        select: { id: true, createdById: true },
      })
      if (!t) return
      tableId     = t.id
      createdById = t.createdById
    } else if (tableOrId && typeof tableOrId === 'object') {
      tableId     = tableOrId.id
      createdById = tableOrId.createdById
    }
    if (!tableId || createdById !== 'anonymous') return
    await db.table.delete({ where: { id: tableId } })
    dispatchTableReleased(tableId, TABLE_RELEASED_REASONS.GUEST_CLEANUP)
  } catch (err) {
    logger.warn({ err: err.message }, 'deleteIfGuestTable failed')
  }
}

async function resolveSocketUser(token) {
  if (!token) return null
  try {
    const [rawHeader] = token.split('.')
    const { kid } = JSON.parse(Buffer.from(rawHeader, 'base64url').toString())
    if (!kid) return null

    const jwk = await db.jwks.findUnique({ where: { id: kid } })
    if (!jwk) return null

    const cryptoKey = await importJWK(JSON.parse(jwk.publicKey), 'EdDSA')
    const { payload } = await jwtVerify(token, cryptoKey)
    if (!payload?.sub) return null

    const activeSession = await db.baSession.findFirst({
      where: { userId: payload.sub, expiresAt: { gt: new Date() } },
      select: { id: true },
    })
    if (!activeSession) return null

    return await getUserByBetterAuthId(payload.sub)
  } catch (err) {
    logger.warn({ err: err.message }, 'resolveSocketUser: JWT verification failed')
    return null
  }
}


// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Attach Socket.io to an HTTP server.
 * @param {import('http').Server} httpServer
 * @returns {import('socket.io').Server}
 */
export async function attachSocketIO(httpServer) {
  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',').map(o => o.trim()).filter(Boolean)
  const io = new Server(httpServer, {
    cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  })

  // Redis adapter for horizontal scaling.
  //
  // ioredis defaults to eager auto-connect: `new Redis(url)` already opens
  // the socket. Calling `.connect()` afterward throws "Redis is already
  // connecting/connected", which used to land us in the in-memory branch on
  // every boot — including when redis was healthy and reachable. The pub/sub
  // pair would then silently degrade horizontal-scale guarantees and
  // eventually starve the notification stream once its backlog grew.
  //
  // Fix: pass `lazyConnect: true` so auto-connect is disabled, then drive
  // the connection ourselves. `duplicate()` inherits the option for the
  // sub client.
  if (process.env.REDIS_URL) {
    try {
      const pubClient = new Redis(process.env.REDIS_URL, { lazyConnect: true })
      const subClient = pubClient.duplicate()
      pubClient.on('connect', () => incrementRedis())
      pubClient.on('end',     () => decrementRedis())
      subClient.on('connect', () => incrementRedis())
      subClient.on('end',     () => decrementRedis())
      await Promise.all([pubClient.connect(), subClient.connect()])
      io.adapter(createAdapter(pubClient, subClient))
      _socketAdapterState = 'redis'
      logger.info('Socket.io Redis adapter connected')
    } catch (err) {
      _socketAdapterState = 'in-memory'
      logger.warn({ err: err.message }, 'Redis adapter unavailable, using in-memory adapter')
    }
  } else {
    _socketAdapterState = 'in-memory'
  }

  io.on('connection', (socket) => {
    incrementSocket()
    logger.info({ socketId: socket.id }, 'socket connected')

    const cleanups = []
    const on = (event, handler) => cleanups.push(trackedOn(socket, event, handler))

    // ── Reconnect handling ────────────────────────────────────────
    // When a user reconnects (new socket, same userId), check if they have
    // an ACTIVE table with a pending disconnect timer. If so, cancel the
    // timer, remap the socket, and rejoin the game instead of creating a
    // new one. This handles Safari tab-switch (which disconnects the socket
    // on visibilitychange:hidden) and brief network hiccups.

    async function tryReconnect(user) {
      if (!user?.betterAuthId) return null
      const baId = user.betterAuthId

      // Check for a pending disconnect timer for this user
      for (const [oldSid, info] of _disconnectTimers) {
        if (info.tableId) {
          const table = await db.table.findUnique({ where: { id: info.tableId } })
          if (!table || table.status !== 'ACTIVE') continue
          const seats = table.seats || []
          const isMine = seats.some(s => s.userId === baId && s.status === 'occupied')
          if (!isMine) continue

          // Found it — cancel the forfeit timer, remap socket, rejoin
          clearTimeout(info.timerId)
          _disconnectTimers.delete(oldSid)
          unregisterSocket(oldSid)
          registerSocket(socket.id, table.id, baId)
          socket.join(`table:${table.id}`)
          clearIdleTimer(oldSid)

          // Re-emit game state so the client picks up where it left off
          const ps = table.previewState || {}
          socket.emit('room:created:hvb', {
            slug: table.slug,
            label: formatTableLabel(table, baId),
            mark: ps.marks?.[baId] ?? 'X',
            board: ps.board,
            currentTurn: ps.currentTurn,
          })

          // Notify the room the player reconnected — Phase 5 dual-emit so
          // SSE-side spectators clear the "opponent disconnected" overlay.
          dualEmitLifecycle(io, table.id, 'playerReconnected', { userId: baId })

          // Restart idle timer
          const { warnMs, graceMs } = await getIdleConfig()
          const { onWarn, onAbandon, onKick } = makeIdleCallbacks(io)
          resetIdleTimer({ socketId: socket.id, tableId: table.id, isPlayer: true, warnMs, graceMs, onWarn, onAbandon, onKick })

          logger.info({ socketId: socket.id, tableId: table.id, userId: baId }, 'Player reconnected to active table')
          return table
        }
      }
      return null
    }

    // ── Room lifecycle ──────────────────────────────────────────────

    on('room:create', async ({ spectatorAllowed = true, authToken = null } = {}) => {
      try {
        const user = await resolveSocketUser(authToken)
        if (!socket.connected) return

        // Check for reconnect first — if the user has an active game with
        // a pending disconnect timer, rejoin it instead of creating a new one
        const reconnected = await tryReconnect(user)
        if (reconnected) return

        // If this socket already owns a FORMING table, close it first (StrictMode double-invoke)
        const existingTableId = _socketToTable.get(socket.id)
        if (existingTableId) {
          const existing = await db.table.findUnique({
            where:  { id: existingTableId },
            select: { seats: true },
          }).catch(() => null)
          await db.table.update({
            where: { id: existingTableId },
            data:  { status: 'COMPLETED', seats: releaseSeats(existing?.seats) },
          }).catch(() => {})
          await deleteIfGuestTable(existingTableId)
          unregisterSocket(socket.id)
        }

        const slug = nanoid(8)

        // Use betterAuthId for seats/marks — matches session.user.id on the frontend.
        // For guests (no auth), use a socket-derived sentinel so seats/marks always
        // have a non-null userId. Without this, findUserIdForSocket can't tell the
        // guest apart from empty seats and game:move silently fails.
        const baId = user?.betterAuthId ?? `guest:${socket.id}`
        const marks = { [baId]: 'X' }

        // Guest tables are always private — they're ephemeral throwaway games
        // that shouldn't clutter the public Tables list. Table GC auto-cleans
        // them after completion (COMPLETED + >24h).
        const isGuest = !user?.betterAuthId
        const table = await createTableTracked({
          data: {
            gameId: 'xo',
            slug,
            createdById: user?.betterAuthId ?? 'anonymous',
            minPlayers: 2,
            maxPlayers: 2,
            isPrivate: isGuest || !spectatorAllowed,
            status: 'FORMING',
            seats: [
              { userId: baId, status: 'occupied', displayName: user?.displayName ?? 'Guest' },
              { userId: null, status: 'empty' },
            ],
            previewState: makePreviewState({ marks }),
          },
        })

        registerSocket(socket.id, table.id, baId)
        socket.join(`table:${table.id}`)
        socket.emit('room:created', { slug: table.slug, label: formatTableLabel(table, baId), mark: 'X' })
      } catch (err) {
        socket.emit('error', { message: err.message })
      }
    })

    on('room:create:hvb', async ({ gameId = 'xo', botUserId, botSkillId, spectatorAllowed = true, authToken = null, tournamentMatchId = null } = {}) => {
      try {
        logger.info({ socketId: socket.id, gameId, botUserId, tournamentMatchId, hasAuthToken: !!authToken }, 'room:create:hvb received')
        if (!botUserId) return socket.emit('error', { message: 'botUserId required' })
        const user = await resolveSocketUser(authToken)
        if (!socket.connected) return

        // Check for reconnect — if the user has an active HvB game with a
        // pending disconnect timer, rejoin it instead of creating a new one
        const reconnected = await tryReconnect(user)
        if (reconnected) return

        logger.info({ tournamentMatchId, hasUser: !!user, hasBetterAuthId: !!user?.betterAuthId }, 'room:create:hvb — about to check tournament reuse')

        // Tournament HvB series reuse. Without this, every "Play Match" click
        // creates a fresh Table with scores={X:0,O:0}, so a player who
        // navigates away mid-series loses all accumulated wins and the series
        // never reaches the required win count.
        if (tournamentMatchId && user?.betterAuthId) {
          const existing = await db.table.findFirst({
            where: { tournamentMatchId },
            orderBy: { createdAt: 'desc' },
          })
          if (existing) {
            const eps = existing.previewState || {}
            const hostSeatId = existing.seats?.[0]?.userId
            if (hostSeatId === user.betterAuthId) {
              const xWins = eps.scores?.X ?? 0
              const oWins = eps.scores?.O ?? 0
              const required = Math.ceil((existing.bestOfN ?? 1) / 2)
              const seriesDone = xWins >= required || oWins >= required

              if (existing.status === 'ACTIVE') {
                // Rejoin in-progress game.
                const prev = _socketToTable.get(socket.id)
                if (prev && prev !== existing.id) {
                  socket.leave(`table:${prev}`)
                  clearIdleTimer(socket.id)
                }
                registerSocket(socket.id, existing.id, user.betterAuthId)
                socket.join(`table:${existing.id}`)
                socket.emit('room:created:hvb', {
                  slug: existing.slug,
                  label: formatTableLabel(existing, user.betterAuthId),
                  mark: eps.marks?.[user.betterAuthId] ?? 'X',
                  board: eps.board,
                  currentTurn: eps.currentTurn,
                })
                logger.info({ tableId: existing.id, tournamentMatchId }, 'hvb tournament table rejoined (active)')
                return
              }

              if (existing.status === 'COMPLETED' && !seriesDone) {
                // Rematch-in-place: preserve scores, increment round, new board.
                const fps = { ...eps }
                fps.board = Array(9).fill(null)
                fps.currentTurn = fps.currentTurn === 'X' ? 'O' : 'X'
                fps.winner = null
                fps.winLine = null
                fps.moves = []
                fps.round = (fps.round || 1) + 1

                const refreshed = await db.table.update({
                  where: { id: existing.id },
                  data: { status: 'ACTIVE', previewState: fps },
                })

                const prev = _socketToTable.get(socket.id)
                if (prev && prev !== refreshed.id) {
                  socket.leave(`table:${prev}`)
                  clearIdleTimer(socket.id)
                }
                registerSocket(socket.id, refreshed.id, user.betterAuthId)
                socket.join(`table:${refreshed.id}`)
                socket.emit('room:created:hvb', {
                  slug: refreshed.slug,
                  label: formatTableLabel(refreshed, user.betterAuthId),
                  mark: fps.marks?.[user.betterAuthId] ?? 'X',
                  board: fps.board,
                  currentTurn: fps.currentTurn,
                })
                logger.info({ tableId: refreshed.id, tournamentMatchId, round: fps.round, scores: fps.scores }, 'hvb tournament table reused (rematch-in-place)')

                // Bot opening if alternation put the bot on move.
                if (refreshed.isHvb && fps.currentTurn === fps.botMark) {
                  dispatchBotMove(refreshed, io).catch((err) => logger.warn({ err }, 'Failed to dispatch bot opening on tournament reuse'))
                }
                return
              }

              // COMPLETED + seriesDone → fall through (defensive; UI shouldn't
              // offer Play again, but create a fresh table if it does).
              logger.warn({ tableId: existing.id, tournamentMatchId }, 'tournament series already complete — creating new table')
            }
          }
        }

        // If this socket was previously in another table (e.g., guest navigated
        // away and back), clean up the old game completely — leave the socket
        // room, mark it COMPLETED, clear timers. Without this, stale events
        // (room:abandoned, game:forfeit from the old table's timers) corrupt
        // the new game and leave the board frozen.
        const existingTableId = _socketToTable.get(socket.id)
        if (existingTableId) {
          socket.leave(`table:${existingTableId}`)
          clearIdleTimer(socket.id)
          clearAllIdleTimersForTable(existingTableId)
          // Cancel any pending disconnect timer for this socket
          const dt = _disconnectTimers.get(socket.id)
          if (dt) { clearTimeout(dt.timerId); _disconnectTimers.delete(socket.id) }
          const existing = await db.table.findUnique({
            where:  { id: existingTableId },
            select: { seats: true },
          }).catch(() => null)
          await db.table.update({
            where: { id: existingTableId },
            data:  { status: 'COMPLETED', seats: releaseSeats(existing?.seats) },
          }).catch(() => {})
          await deleteIfGuestTable(existingTableId)
          unregisterSocket(socket.id)
        }

        const slug = nanoid(8)

        const baId = user?.betterAuthId ?? `guest:${socket.id}`

        // `botUserId` from the client is betterAuthId for real community bots,
        // but seeded tournament bots have no betterAuthId — callers pass the
        // plain User.id instead. Accept either and resolve to a canonical
        // seat identifier (`betterAuthId ?? User.id`) the rest of the code
        // can rely on.
        let botUserRow = await db.user.findFirst({
          where: { betterAuthId: botUserId },
          select: { id: true, betterAuthId: true },
        })
        if (!botUserRow) {
          botUserRow = await db.user.findUnique({
            where: { id: botUserId },
            select: { id: true, betterAuthId: true },
          })
        }
        if (!botUserRow) return socket.emit('error', { message: 'Bot not found' })
        const botSeatId = botUserRow.betterAuthId ?? botUserRow.id
        const marks = { [baId]: 'X', [botSeatId]: 'O' }

        // Resolve the game-specific skill server-side so the wrong-game skill
        // can never be used (e.g. an XO skill running in a Connect4 game).
        let resolvedSkillId = botSkillId || null
        {
          const skill = await resolveSkillForGame(botUserRow.id, gameId)
          if (skill) resolvedSkillId = skill.id
        }

        // For tournament MIXED matches: resolve tournamentId + bestOfN from the
        // match's tournament so the series play and result recording work like
        // a first-class tournament game. Unauthenticated or spectator callers
        // shouldn't create tournament HvB tables — silently drop the hint.
        let tourIdForTable = null
        let tourMatchIdForTable = null
        let tourBestOfN = null
        let tourMatchOpponentName = null
        if (tournamentMatchId && user?.betterAuthId) {
          try {
            const tm = await db.tournamentMatch.findUnique({
              where: { id: tournamentMatchId },
              select: {
                tournamentId: true,
                participant1Id: true,
                participant2Id: true,
              },
            })
            const tour = tm?.tournamentId
              ? await db.tournament.findUnique({
                  where: { id: tm.tournamentId },
                  select: { bestOfN: true, mode: true },
                })
              : null
            if (tm && tour && tour.mode === 'MIXED') {
              tourIdForTable     = tm.tournamentId
              tourMatchIdForTable = tournamentMatchId
              tourBestOfN        = tour.bestOfN ?? null
              logger.info({ tournamentMatchId, tourBestOfN, mode: tour.mode }, 'hvb table linked to tournament match')
            } else {
              logger.warn({ tournamentMatchId, mode: tour?.mode, hasTM: !!tm }, 'hvb tournament link skipped — mode not MIXED or match not found')

              if (tm) {
                // Look up the opponent participant's display name for the seat
                const me = await db.user.findUnique({
                  where: { betterAuthId: user.betterAuthId },
                  select: { id: true },
                })
                if (me?.id) {
                  const participantIds = [tm.participant1Id, tm.participant2Id].filter(Boolean)
                  const participants = await db.tournamentParticipant.findMany({
                    where: { id: { in: participantIds } },
                    select: { userId: true, user: { select: { displayName: true } } },
                  })
                  const opponent = participants.find(p => p.userId !== me.id)
                  tourMatchOpponentName = opponent?.user?.displayName ?? null
                }
              }
            }
          } catch (err) {
            logger.warn({ err, tournamentMatchId }, 'failed to resolve tournament match for hvb table')
          }
        }

        const isGuest = !user?.betterAuthId
        // Bot's seat-display name preference: tournament-resolved opponent
        // name (for MIXED matches), else the bot's own user.displayName, else
        // a generic 'Bot' fallback. Surfaced via formatTableLabel.
        const botSeatDisplayName = tourMatchOpponentName
          ?? (await db.user.findUnique({ where: { id: botUserRow.id }, select: { displayName: true } }).catch(() => null))?.displayName
          ?? 'Bot'
        const table = await createTableTracked({
          data: {
            gameId,
            slug,
            createdById: user?.betterAuthId ?? 'anonymous',
            minPlayers: 2,
            maxPlayers: 2,
            isPrivate: isGuest || !spectatorAllowed,
            status: 'ACTIVE',
            isHvb: true,
            botUserId: botSeatId,
            botSkillId: resolvedSkillId,
            tournamentId:      tourIdForTable,
            tournamentMatchId: tourMatchIdForTable,
            isTournament:      !!tourMatchIdForTable,
            bestOfN:           tourBestOfN,
            seats: [
              { userId: baId,       status: 'occupied', displayName: user?.displayName ?? 'Guest' },
              { userId: botSeatId,  status: 'occupied', displayName: botSeatDisplayName },
            ],
            previewState: makePreviewState({ marks, botMark: 'O' }),
          },
        })

        registerSocket(socket.id, table.id, baId)
        socket.join(`table:${table.id}`)
        const ps = table.previewState
        socket.emit('room:created:hvb', {
          slug: table.slug,
          label: formatTableLabel(table, baId),
          mark: 'X',
          board: ps.board,
          currentTurn: ps.currentTurn,
        })

        // Start idle timer for the human
        const { warnMs, graceMs } = await getIdleConfig()
        const { onWarn, onAbandon, onKick } = makeIdleCallbacks(io)
        resetIdleTimer({ socketId: socket.id, tableId: table.id, isPlayer: true, warnMs, graceMs, onWarn, onAbandon, onKick })
      } catch (err) {
        socket.emit('error', { message: err.message })
      }
    })

    on('room:join', async ({ slug, role = 'player', authToken = null }) => {
      const user = await resolveSocketUser(authToken)
      if (!socket.connected) return

      if (role === 'spectator') {
        // Try PvP tables first (by slug), then bot game rooms
        const table = await db.table.findFirst({ where: { slug } })
        // Demo tables (Hook step 2): the Table row is private + bot-vs-bot,
        // but botGameRunner owns the move stream — game:moved events are
        // emitted to io.to(slug), not io.to(`table:${id}`). Route the viewer
        // through the bot-game spectator path so they actually see the game.
        // The isPrivate gate doesn't apply to demos: the creator IS the
        // intended audience. (Other private tables stay locked.)
        if (table?.isDemo && botGameRunner.hasSlug(slug)) {
          const result = botGameRunner.joinAsSpectator({ slug, socketId: socket.id })
          if (result.error) return socket.emit('error', { message: result.error })
          socket.join(slug)
          const g = result.game
          socket.emit('room:joined', {
            slug,
            role: 'spectator',
            room: {
              slug: g.slug,
              label: `${g.bot1.displayName} vs ${g.bot2.displayName}`,
              status: g.status,
              board: g.board,
              currentTurn: g.currentTurn,
              winner: g.winner,
              winLine: g.winLine,
              scores: { X: g.seriesBot1Wins, O: g.seriesBot2Wins },
              round: g.seriesGamesPlayed + 1,
              spectatorCount: g.spectatorIds.size,
              spectatorAllowed: true,
              isBotGame: true,
              bot1: { displayName: g.bot1.displayName, mark: 'X' },
              bot2: { displayName: g.bot2.displayName, mark: 'O' },
            },
          })
          io.to(slug).emit('room:spectatorJoined', { spectatorCount: g.spectatorIds.size })
          return
        }
        if (table) {
          if (table.isPrivate) return socket.emit('error', { message: 'Spectators not allowed in this room' })
          registerSocket(socket.id, table.id, null)
          _spectatorSockets.set(socket.id, table.id)
          socket.join(`table:${table.id}`)
          const spectatorCount = getSpectatorCount(table.id)
          socket.emit('room:joined', { slug, role: 'spectator', room: { ...sanitizeTable(table), spectatorCount } })
          // Notify the rest of the room (host + guest + other spectators) so
          // their useGameSDK updates session.settings.spectatorCount and the
          // sidebar shows "N watching". `broadcastTablePresence` below powers
          // TableDetailPage's SSE fallback but doesn't feed useGameSDK, which
          // listens for room:spectatorJoined specifically.
          // Phase 5: dual-emit room:spectatorJoined. Socket flavor uses
          // socket.to(...) (everyone except the joiner — they already get
          // the count back in their room:joined response). SSE side appends
          // to the lifecycle channel; the joining client picks it up via
          // their fresh table:watch subscription, but the payload is
          // idempotent (same spectatorCount they got in room:joined).
          socket.to(`table:${table.id}`).emit('room:spectatorJoined', { spectatorCount })
          appendToStream(
            `table:${table.id}:lifecycle`,
            { kind: 'spectatorJoined', spectatorCount },
            { userId: '*' },
          ).catch(() => {})
          broadcastTablePresence(io, table.id)
          // Start spectator idle timer if game is in progress
          if (table.status === 'ACTIVE') {
            const { graceMs, spectatorMs } = await getIdleConfig()
            const { onWarn, onAbandon, onKick } = makeIdleCallbacks(io)
            resetIdleTimer({ socketId: socket.id, tableId: table.id, isPlayer: false, warnMs: spectatorMs, graceMs, onWarn, onAbandon, onKick })
          }
        } else if (botGameRunner.hasSlug(slug)) {
          const result = botGameRunner.joinAsSpectator({ slug, socketId: socket.id })
          if (result.error) return socket.emit('error', { message: result.error })
          socket.join(slug)
          const g = result.game
          socket.emit('room:joined', {
            slug,
            role: 'spectator',
            room: {
              slug: g.slug,
              label: `${g.bot1.displayName} vs ${g.bot2.displayName}`,
              status: g.status,
              board: g.board,
              currentTurn: g.currentTurn,
              winner: g.winner,
              winLine: g.winLine,
              scores: { X: g.seriesBot1Wins, O: g.seriesBot2Wins },
              round: g.seriesGamesPlayed + 1,
              spectatorCount: g.spectatorIds.size,
              spectatorAllowed: true,
              isBotGame: true,
              bot1: { displayName: g.bot1.displayName, mark: 'X' },
              bot2: { displayName: g.bot2.displayName, mark: 'O' },
            },
          })
          io.to(slug).emit('room:spectatorJoined', { spectatorCount: g.spectatorIds.size })
        } else {
          return socket.emit('error', { message: 'Room not found' })
        }
      } else {
        // Player join — two shapes:
        //   (1) FORMING + caller not yet seated  → legacy socket-first flow
        //       (Mt. room style): seat the caller in seat 1, flip ACTIVE,
        //       emit game:start. Still used by /play?join=… and tournament
        //       match room wiring.
        //   (2) ACTIVE + caller already seated   → Tables flow re-attach:
        //       HTTP POST /join already filled the seats + flipped ACTIVE,
        //       we just need to bind this socket to that table and emit the
        //       current state so the client renders the live board.
        const table = await db.table.findFirst({ where: { slug } })
        if (!table) return socket.emit('error', { message: 'Room not found' })

        const seats = table.seats || []
        const baId = user?.betterAuthId ?? `guest:${socket.id}`

        // Shared ELO lookup for sanitize payload — used by both shapes.
        async function buildExtras(hostSeat, guestSeat, guestUserDomainId) {
          let hostUserElo = null
          const hostBaId = hostSeat?.userId
          if (hostBaId) {
            const hostUser = await db.user.findUnique({ where: { betterAuthId: hostBaId }, select: { id: true } })
            if (hostUser) {
              const eloRow = await db.gameElo.findUnique({ where: { userId_gameId: { userId: hostUser.id, gameId: 'xo' } } })
              hostUserElo = eloRow?.rating ?? null
            }
          }
          let guestUserElo = null
          if (guestUserDomainId) {
            const eloRow = await db.gameElo.findUnique({ where: { userId_gameId: { userId: guestUserDomainId, gameId: 'xo' } } })
            guestUserElo = eloRow?.rating ?? null
          }
          return {
            hostUserDisplayName:  hostSeat?.displayName  ?? null,
            hostUserElo,
            guestUserDisplayName: guestSeat?.displayName ?? null,
            guestUserElo,
          }
        }

        if (table.status === 'ACTIVE') {
          const mySeat = seats.findIndex(s => s?.userId === baId && s?.status === 'occupied')
          if (mySeat === -1) {
            // Not seated at an ACTIVE table → client will fall back to
            // spectator role via its "Room is full" handler. This is the
            // correct UX: the table is indeed full for this caller.
            return socket.emit('error', { message: 'Room is full' })
          }
          // Cancel any pending forfeit timer for this user+table (socket
          // reconnect after brief disconnect — same user, new socket.id).
          for (const [oldSid, info] of _disconnectTimers) {
            if (info.tableId === table.id) {
              const oldSeats = table.seats || []
              const wasMe = oldSeats.some(s => s.userId === baId && s.status === 'occupied')
              if (wasMe) {
                clearTimeout(info.timerId)
                _disconnectTimers.delete(oldSid)
                unregisterSocket(oldSid)
                dualEmitLifecycle(io, table.id, 'playerReconnected', { mark: table.previewState?.marks?.[baId] })
                break
              }
            }
          }

          registerSocket(socket.id, table.id, baId)
          socket.join(`table:${table.id}`)
          const ps = table.previewState || {}
          const mark = ps.marks?.[baId] ?? (mySeat === 0 ? 'X' : 'O')

          // Resolve domain User.id for ELO lookup. `user?.id` is the domain
          // User.id when authed via JWT; unauth'd sockets skip ELO.
          const extras = await buildExtras(seats[0], seats[1], user?.id ?? null)

          socket.emit('room:joined', { slug, role: 'player', mark, room: sanitizeTable(table, extras) })
          // Fresh game:start for this socket — idempotent on the client; no
          // broadcast because the other seat's socket (if present) got its
          // own game:start on its own attach. If this is the first socket to
          // attach after the HTTP join, the other side will get theirs when
          // it connects.
          socket.emit('game:start', {
            board:       ps.board,
            currentTurn: ps.currentTurn,
            round:       ps.round ?? 1,
          })

          const { warnMs, graceMs } = await getIdleConfig()
          const { onWarn, onAbandon, onKick } = makeIdleCallbacks(io)
          resetIdleTimer({ socketId: socket.id, tableId: table.id, isPlayer: true, warnMs, graceMs, onWarn, onAbandon, onKick })
          return
        }

        // table.status === 'FORMING' — legacy socket-first join flow.
        if (table.status !== 'FORMING') return socket.emit('error', { message: 'Room not found' })
        if (seats[1]?.status === 'occupied') return socket.emit('error', { message: 'Room is full' })

        // Tournament room host reconnecting — caller is already in seat 0.
        // Re-attach the socket without changing seats or activating the table;
        // it stays FORMING until the second player arrives.
        if (seats[0]?.userId === baId && seats[0]?.status === 'occupied') {
          registerSocket(socket.id, table.id, baId)
          socket.join(`table:${table.id}`)
          const mark = table.previewState?.marks?.[baId] ?? 'X'
          const extras = await buildExtras(seats[0], seats[1], user?.id ?? null)
          socket.emit('room:joined', { slug, role: 'player', mark, room: sanitizeTable(table, extras) })
          return
        }

        // Tournament rooms require an authenticated player in the second seat.
        // If authToken didn't resolve on the client before room:join fired (race
        // between optimistic session hydration and socket emit), reject cleanly.
        // The frontend retries via its getToken() path on the next connect event.
        if (table.isTournament && !user?.betterAuthId) {
          return socket.emit('error', { message: 'Authentication required for this match' })
        }

        // Table was created via REST with empty seats (Tables paradigm) and the
        // creator is the first to hit the share URL. Seat them at seat 0 with
        // mark X. If the guest beat them to it (their room:join already took
        // seat 1), both seats are now full — promote to ACTIVE and emit
        // game:start so both sides receive an initialized board.
        if (seats[0]?.status !== 'occupied' && baId === table.createdById) {
          const priorPs = table.previewState || {}
          const marks = { ...(priorPs.marks || {}), [baId]: 'X' }
          const newSeats = [
            { userId: baId, status: 'occupied', displayName: user?.displayName ?? 'Host' },
            seats[1] || { userId: null, status: 'empty' },
          ]
          const bothSeated = newSeats.every(s => s?.status === 'occupied')
          const ps = bothSeated
            ? { ...makePreviewState({ marks }), scores: priorPs.scores ?? { X: 0, O: 0 } }
            : { ...priorPs, marks }
          const updated = await db.table.update({
            where: { id: table.id },
            data: {
              status: bothSeated ? 'ACTIVE' : 'FORMING',
              seats: newSeats,
              previewState: ps,
            },
          })
          registerSocket(socket.id, updated.id, baId)
          socket.join(`table:${updated.id}`)
          const extras = await buildExtras(newSeats[0], newSeats[1], user?.id ?? null)
          socket.emit('room:joined', { slug, role: 'player', mark: 'X', room: sanitizeTable(updated, extras) })
          if (bothSeated) {
            dualEmitLifecycle(io, updated.id, 'guestJoined', { room: sanitizeTable(updated, extras) })
            io.to(`table:${updated.id}`).emit('game:start', {
              board: ps.board,
              currentTurn: ps.currentTurn,
              round: ps.round ?? 1,
            })
          }
          return
        }

        // Guest joining a FORMING table. Seat them at seat 1 regardless of
        // whether seat 0 is currently occupied — when host and guest arrive
        // nearly simultaneously (share-link flow), the guest's room:join may
        // reach the server before host's seat-0 update commits. Only promote
        // the table to ACTIVE and emit game:start once BOTH seats end up
        // occupied; until then the table stays FORMING and the host's own
        // room:join (which runs the creator→seat-0 branch above) fills the
        // last empty seat before emitting the activation events.
        const priorPs = table.previewState || {}
        const marks = { ...(priorPs.marks || {}) }
        if (seats[0]?.userId) marks[seats[0].userId] = marks[seats[0].userId] || 'X'
        marks[baId] = 'O'

        const newSeats = [
          seats[0] || { userId: null, status: 'empty' },
          { userId: baId, status: 'occupied', displayName: user?.displayName ?? 'Guest' },
        ]
        const bothSeated = newSeats.every(s => s?.status === 'occupied')
        const ps = bothSeated
          ? { ...makePreviewState({ marks }), scores: priorPs.scores ?? { X: 0, O: 0 } }
          : { ...priorPs, marks }

        const updated = await db.table.update({
          where: { id: table.id },
          data: {
            status: bothSeated ? 'ACTIVE' : 'FORMING',
            seats: newSeats,
            previewState: ps,
          },
        })

        registerSocket(socket.id, updated.id, baId)
        socket.join(`table:${updated.id}`)

        const extras = await buildExtras(newSeats[0], newSeats[1], user?.id ?? null)

        socket.emit('room:joined', { slug, role: 'player', mark: 'O', room: sanitizeTable(updated, extras) })
        dualEmitLifecycle(io, updated.id, 'guestJoined', { room: sanitizeTable(updated, extras) })
        if (bothSeated) {
          io.to(`table:${updated.id}`).emit('game:start', {
            board: ps.board,
            currentTurn: ps.currentTurn,
            round: ps.round ?? 1,
          })
        }

        // Start idle timers for both players
        const { warnMs, graceMs } = await getIdleConfig()
        const { onWarn, onAbandon, onKick } = makeIdleCallbacks(io)
        // Host socket — find it from _socketToTable
        for (const [sid, tid] of _socketToTable) {
          if (tid === updated.id && sid !== socket.id) {
            resetIdleTimer({ socketId: sid, tableId: updated.id, isPlayer: true, warnMs, graceMs, onWarn, onAbandon, onKick })
          }
        }
        resetIdleTimer({ socketId: socket.id, tableId: updated.id, isPlayer: true, warnMs, graceMs, onWarn, onAbandon, onKick })
      }
    })

    on('room:cancel', async () => {
      const tableId = _socketToTable.get(socket.id)
      if (!tableId) return

      const table = await db.table.findUnique({ where: { id: tableId } })
      if (table) {
        await db.table.update({
          where: { id: tableId },
          data:  { status: 'COMPLETED', seats: releaseSeats(table.seats) },
        }).catch(() => {})
        dispatchTableReleased(tableId, TABLE_RELEASED_REASONS.LEAVE, { trigger: 'room-cancel' })
        await deleteIfGuestTable(table)
        if (table.tournamentMatchId) deletePendingPvpMatch(table.tournamentMatchId)
      }

      dualEmitLifecycle(io, tableId, 'cancelled')
      broadcastTablePresence(io, tableId)  // F8 — final spectator refresh before unregister
      clearAllIdleTimersForTable(tableId)
      // Remove all socket mappings for this table; also drop each socket
      // from the `table:${id}` socket.io room (chunk 3 P1 — socket.leave
      // symmetry) so a stale event emitted to that room after this point
      // can't accidentally reach the cancelling client.
      for (const [sid, tid] of _socketToTable) {
        if (tid === tableId) {
          io.sockets.sockets.get(sid)?.leave(`table:${tableId}`)
          unregisterSocket(sid)
        }
      }
    })

    // ── Game events ─────────────────────────────────────────────────

    on('game:move', async ({ cellIndex }) => {
      const tableId = _socketToTable.get(socket.id)
      if (!tableId) return socket.emit('error', { message: 'Not in a room' })

      const table = await db.table.findUnique({ where: { id: tableId } })
      if (!table) return socket.emit('error', { message: 'Room not found' })
      if (table.status !== 'ACTIVE') return socket.emit('error', { message: 'Game not in progress' })

      const ps = { ...table.previewState }
      const marks = ps.marks || {}
      const seats = table.seats || []

      // Determine this player's userId — find from seats which userId maps to this socket
      const myUserId = findUserIdForSocket(socket.id, tableId, seats)
      if (!myUserId) return socket.emit('error', { message: 'Not a player in this room' })

      const playerMark = marks[myUserId]
      if (!playerMark) return socket.emit('error', { message: 'Not a player in this room' })
      if (playerMark !== ps.currentTurn) return socket.emit('error', { message: 'Not your turn' })
      if (ps.board[cellIndex] !== null) return socket.emit('error', { message: 'Cell already occupied' })

      // Apply move
      ps.board[cellIndex] = playerMark
      ps.moves = ps.moves || []
      ps.moves.push({ n: ps.moves.length + 1, m: playerMark, c: cellIndex })

      const winner = getWinner(ps.board)
      const draw = !winner && isBoardFull(ps.board)

      let newStatus = table.status
      if (winner) {
        ps.winner = winner.mark ?? winner
        ps.winLine = winner.line ?? WIN_LINES.find(([a, b, c]) =>
          ps.board[a] === ps.winner && ps.board[b] === ps.winner && ps.board[c] === ps.winner
        ) ?? null
        const winMark = ps.winner
        ps.scores[winMark] = (ps.scores[winMark] || 0) + 1
        newStatus = 'COMPLETED'
      } else if (draw) {
        ps.winner = null
        newStatus = 'COMPLETED'
      } else {
        ps.currentTurn = playerMark === 'X' ? 'O' : 'X'
      }

      const updated = await db.table.update({
        where: { id: tableId },
        data: { previewState: ps, status: newStatus },
      })

      io.to(`table:${tableId}`).emit('game:moved', {
        cellIndex,
        board: ps.board,
        currentTurn: ps.currentTurn,
        status: mapStatus(newStatus),
        winner: ps.winner,
        winLine: ps.winLine,
        scores: ps.scores,
        round: ps.round ?? 1,
      })

      if (newStatus === 'COMPLETED') {
        clearAllIdleTimersForTable(tableId)
        dispatchTableReleased(tableId, TABLE_RELEASED_REASONS.GAME_END, { trigger: 'game-move' })
        broadcastTablePresence(io, tableId)  // F8 — spectators see status flip
        recordPvpGame(updated, io).catch((err) => logger.warn({ err }, 'Failed to record PvP game'))
        // Guest-table deletion is intentionally deferred here — see the
        // timing rule documented on deleteIfGuestTable. The disconnect
        // branch picks it up; tableGcService is the 24h backstop.
      } else {
        // Track activity for the mover
        if (myUserId) recordActivity(myUserId)

        const { warnMs, graceMs } = await getIdleConfig()
        const { onWarn, onAbandon, onKick } = makeIdleCallbacks(io)
        for (const [sid, tid] of _socketToTable) {
          if (tid === tableId && !_spectatorSockets.has(sid)) {
            resetIdleTimer({ socketId: sid, tableId, isPlayer: true, warnMs, graceMs, onWarn, onAbandon, onKick })
          }
        }

        // HvB: dispatch bot move
        if (table.isHvb) {
          dispatchBotMove(updated, io).catch((err) => logger.warn({ err }, 'Failed to dispatch bot move'))
        }
      }
    })

    on('idle:pong', async () => {
      // The legacy socket path retains the original socket-id reset (it's
      // O(1) and avoids touching the user→sockets index for the common
      // single-tab case). The shared service `handleIdlePong()` covers the
      // identical behavior from the SSE+POST path.
      const tableId = _socketToTable.get(socket.id)
      if (!tableId) return

      const table = await db.table.findUnique({ where: { id: tableId } })
      if (!table || table.status !== 'ACTIVE') return

      const seats = table.seats || []
      const myUserId = findUserIdForSocket(socket.id, tableId, seats)
      const isPlayer = seats.some(s => s.userId === myUserId && s.status === 'occupied')

      const { warnMs, graceMs, spectatorMs } = await getIdleConfig()
      const { onWarn, onAbandon, onKick } = makeIdleCallbacks(io)
      resetIdleTimer({
        socketId: socket.id,
        tableId,
        isPlayer,
        warnMs: isPlayer ? warnMs : spectatorMs,
        graceMs,
        onWarn,
        onAbandon,
        onKick,
      })
    })

    on('game:rematch', async () => {
      const tableId = _socketToTable.get(socket.id)
      if (!tableId) return socket.emit('error', { message: 'Room not found' })

      const table = await db.table.findUnique({ where: { id: tableId } })
      if (!table) return socket.emit('error', { message: 'Room not found' })
      if (table.status !== 'COMPLETED') return socket.emit('error', { message: 'Game not finished' })

      const ps = { ...table.previewState }
      ps.board = Array(9).fill(null)
      ps.currentTurn = ps.currentTurn === 'X' ? 'O' : 'X'
      ps.winner = null
      ps.winLine = null
      ps.moves = []
      ps.round = (ps.round || 1) + 1
      logger.info({ tableId, tournamentMatchId: table.tournamentMatchId, isHvb: table.isHvb, round: ps.round, scores: ps.scores }, 'game:rematch starting new game')

      const updated = await db.table.update({
        where: { id: tableId },
        data: { status: 'ACTIVE', previewState: ps },
      })

      io.to(`table:${tableId}`).emit('game:start', {
        board: ps.board,
        currentTurn: ps.currentTurn,
        round: ps.round,
        scores: ps.scores,
      })

      // Restart idle timers for both players
      const { warnMs, graceMs } = await getIdleConfig()
      const { onWarn, onAbandon, onKick } = makeIdleCallbacks(io)
      for (const [sid, tid] of _socketToTable) {
        if (tid === tableId) {
          resetIdleTimer({ socketId: sid, tableId, isPlayer: true, warnMs, graceMs, onWarn, onAbandon, onKick })
        }
      }

      // HvB: if bot has opening move after alternation, dispatch it
      if (table.isHvb && ps.currentTurn === ps.botMark) {
        dispatchBotMove(updated, io).catch((err) => logger.warn({ err }, 'Failed to dispatch bot opening move on rematch'))
      }
    })

    on('game:forfeit', async () => {
      const tableId = _socketToTable.get(socket.id)
      if (!tableId) return

      const table = await db.table.findUnique({ where: { id: tableId } })
      if (!table) return

      const ps = { ...table.previewState }
      const seats = table.seats || []
      const myUserId = findUserIdForSocket(socket.id, tableId, seats)
      const mark = ps.marks?.[myUserId]
      if (!mark) return

      const oppMark = mark === 'X' ? 'O' : 'X'
      ps.winner = oppMark
      ps.scores[oppMark] = (ps.scores[oppMark] || 0) + 1

      const updated = await db.table.update({
        where: { id: tableId },
        data: {
          status: 'COMPLETED',
          previewState: ps,
          // The forfeiter is leaving the table. Free their seat so the row
          // doesn't show up as still-occupied in /api/v1/tables. The other
          // player may still be there for the post-game screen — leave them
          // seated until they themselves disconnect or click Leave.
          seats: releaseSeatForUser(seats, myUserId),
        },
      })

      clearAllIdleTimersForTable(tableId)
      io.to(`table:${tableId}`).emit('game:forfeit', { forfeiterMark: mark, winner: oppMark, scores: ps.scores })
      dispatchTableReleased(tableId, TABLE_RELEASED_REASONS.LEAVE, { trigger: 'forfeit' })
      broadcastTablePresence(io, tableId)  // F8
      // Drop the forfeiter from the table room so any future events on this
      // tableId don't re-render in their post-game UI (chunk 3 P1).
      socket.leave(`table:${tableId}`)
      recordPvpGame(updated, io).catch((err) => logger.warn({ err }, 'Failed to record PvP forfeit game'))
      deleteIfGuestTable(updated)
    })

    // ── Post-game leave ──────────────────────────────────────────────
    // Emitted when a player clicks Leave Table after a game finishes.
    // Relays to the rest of the table room so the remaining player knows
    // immediately, without waiting for the socket disconnect timeout.

    on('game:leave', async () => {
      const tableId = _socketToTable.get(socket.id)
      if (!tableId) return
      socket.to(`table:${tableId}`).emit('game:opponent_left')
      // Drop the leaving socket from the room so it stops receiving events
      // for a table it has explicitly left (chunk 3 P1).
      socket.leave(`table:${tableId}`)

      // Free this player's seat so the row stops appearing occupied in the
      // /tables list. game:leave is post-game, so the row is already
      // COMPLETED — we're only updating the seats blob.
      try {
        const table = await db.table.findUnique({
          where:  { id: tableId },
          select: { seats: true },
        })
        if (!table) return
        const myUserId = findUserIdForSocket(socket.id, tableId, table.seats || [])
        if (!myUserId) return
        await db.table.update({
          where: { id: tableId },
          data:  { seats: releaseSeatForUser(table.seats, myUserId) },
        })
      } catch (err) {
        logger.warn({ err: err.message, tableId }, 'game:leave: failed to release seat')
      }
    })

    // ── Emoji reactions ──────────────────────────────────────────────

    on('game:reaction', async ({ emoji }) => {
      if (!ALLOWED_REACTIONS.includes(emoji)) return
      const tableId = _socketToTable.get(socket.id)
      if (!tableId) return

      const table = await db.table.findUnique({ where: { id: tableId } })
      if (!table) return

      const seats = table.seats || []
      const ps = table.previewState || {}
      const myUserId = findUserIdForSocket(socket.id, tableId, seats)
      const fromMark = ps.marks?.[myUserId] ?? 'spectator'
      socket.to(`table:${tableId}`).emit('game:reaction', { emoji, fromMark })
    })

    // ── Tournament PVP match-table join ──────────────────────────────
    // Phase 3 of the Realtime Migration: the data-mutation body of this
    // handler now lives in `services/tournamentMatchService.js` so the
    // SSE+POST transport (`POST /api/v1/rt/tournaments/matches/:id/table`)
    // shares the exact same flow. The legacy `tournament:room:join` /
    // `tournament:room:ready` event names are also accepted/emitted as
    // aliases so any in-flight client tab from before the rename keeps
    // working until Phase 8 strips socket.io entirely.

    async function handleTournamentTableJoin({ matchId, authToken } = {}) {
      if (!matchId) return socket.emit('error', { message: 'matchId required' })

      const user = await resolveSocketUser(authToken)
      if (!socket.connected) return
      if (!user) return socket.emit('error', { message: 'Authentication required' })

      let result
      try {
        result = await joinMatchTable({ user, matchId })
      } catch (err) {
        if (err instanceof TournamentMatchError) {
          if (err.code === 'NOT_FOUND')        return socket.emit('error', { message: 'Tournament match not found or already started' })
          if (err.code === 'NOT_READY')        return socket.emit('error', { message: 'Match not ready yet — please try again' })
          if (err.code === 'NOT_PARTICIPANT')  return socket.emit('error', { message: 'You are not a participant in this match' })
        }
        logger.error({ err, matchId }, 'tournament:table:join failed')
        return socket.emit('error', { message: 'Failed to join match' })
      }

      const { slug, mark, tournamentId, bestOfN, tableId } = result
      registerSocket(socket.id, tableId, user.betterAuthId)
      socket.join(`table:${tableId}`)

      const readyPayload = { slug, mark, tournamentId, matchId, bestOfN }
      socket.emit('tournament:table:ready', readyPayload)
      // Legacy alias for clients that haven't reloaded since the rename.
      socket.emit('tournament:room:ready', readyPayload)
      // Phase 3 SSE dual-emit: clients on the SSE+POST transport pick this
      // up via `tournament:<tournamentId>:table:ready`. Broadcast (no userId
      // filter) so both participants on the tournament page see it; the
      // listener filters by matchId.
      appendToStream(`tournament:${tournamentId}:table:ready`, readyPayload).catch(() => {})

      if (result.action === 'joined') {
        dualEmitLifecycle(io, tableId, 'guestJoined', { room: sanitizeTable(result.table, result.extras) })
        io.to(`table:${tableId}`).emit('game:start', {
          board: result.previewState.board,
          currentTurn: result.previewState.currentTurn,
          round: result.previewState.round ?? 1,
        })

        // Start idle timers for both players
        const { warnMs, graceMs } = await getIdleConfig()
        const { onWarn, onAbandon, onKick } = makeIdleCallbacks(io)
        for (const [sid, tid] of _socketToTable) {
          if (tid === tableId) {
            resetIdleTimer({ socketId: sid, tableId, isPlayer: true, warnMs, graceMs, onWarn, onAbandon, onKick })
          }
        }
      }
    }

    on('tournament:table:join', handleTournamentTableJoin)
    // Legacy alias — pre-Phase-3 clients still emit the old name.
    on('tournament:room:join',  handleTournamentTableJoin)

    // ── Pong spike ───────────────────────────────────────────────────────────

    on('pong:create', ({ slug }) => {
      if (!slug) return socket.emit('error', { message: 'slug required' })
      pongRunner.createRoom(slug)
      socket.join(slug)
      const result = pongRunner.joinRoom(slug, socket.id)
      if (result.error) return socket.emit('error', { message: result.error })
      socket.emit('pong:created', { slug, playerIndex: result.playerIndex })
    })

    on('pong:join', ({ slug }) => {
      if (!slug) return socket.emit('error', { message: 'slug required' })
      if (!pongRunner.hasRoom(slug)) pongRunner.createRoom(slug)
      socket.join(slug)
      const result = pongRunner.joinRoom(slug, socket.id)
      if (result.error) return socket.emit('error', { message: result.error })
      const currentState = pongRunner.getState(slug)
      socket.emit('pong:joined', {
        slug,
        playerIndex: result.playerIndex ?? null,
        spectating:  result.spectating ?? false,
        state:       currentState,
      })
    })

    on('pong:input', ({ slug, direction }) => {
      if (!slug || !direction) return
      pongRunner.applyInput(slug, socket.id, direction)
    })

    // ── Support staff fan-out ────────────────────────────────────────
    // Joins a Socket.io support broadcast group. The SSE+POST equivalent
    // is a `?channels=support:` filter on /events/stream — no POST needed.

    on('support:join', () => {
      socket.join('support')
    })

    // ── ML training progress ─────────────────────────────────────────

    on('ml:watch', ({ sessionId }) => {
      if (sessionId) socket.join(`ml:session:${sessionId}`)
    })

    on('ml:unwatch', ({ sessionId }) => {
      if (sessionId) socket.leave(`ml:session:${sessionId}`)
    })

    // ── Table presence (Phase 3.1) ──────────────────────────────────

    on('table:watch', async ({ tableId, authToken } = {}) => {
      if (!tableId || typeof tableId !== 'string') return
      const user = await resolveSocketUser(authToken)
      const wasNew = addTableWatcher(tableId, socket.id, {
        userId:      user?.id ?? null,
        displayName: user?.displayName ?? user?.username ?? null,
      })
      socket.join(`table:${tableId}`)
      broadcastTablePresence(io, tableId)

      if (wasNew && user?.id) {
        try {
          const table = await db.table.findUnique({
            where: { id: tableId },
            select: { seats: true, isDemo: true },
          })
          const cohort = Array.isArray(table?.seats)
            ? table.seats
                .filter(s => s.status === 'occupied' && typeof s.userId === 'string')
                .map(s => s.userId)
            : []
          if (cohort.length > 0) {
            dispatchBus({
              type: 'spectator.joined',
              targets: { cohort },
              payload: { tableId, userId: user.id },
            }).catch(err => logger.warn({ err: err.message, tableId }, 'spectator.joined dispatch failed'))
          }

          // Demo Table macro (§5.1): credit Hook step 2 after 2 min watch.
          // The bot-game completion path also fires step 2 immediately for
          // any current viewer, so this timer is the "watched ≥ 2 min but
          // didn't see it finish" branch. completeStep is idempotent.
          if (table?.isDemo) {
            let socketTimers = _demoWatchTimers.get(socket.id)
            if (!socketTimers) {
              socketTimers = new Map()
              _demoWatchTimers.set(socket.id, socketTimers)
            }
            if (!socketTimers.has(tableId)) {
              const userId = user.id
              const timer = setTimeout(() => {
                completeJourneyStep(userId, 2).catch(() => {})
                socketTimers.delete(tableId)
              }, DEMO_WATCH_THRESHOLD_MS)
              socketTimers.set(tableId, timer)
            }
          }
        } catch (err) {
          logger.warn({ err: err.message, tableId }, 'spectator cohort lookup failed')
        }
      }
    })

    on('table:unwatch', ({ tableId } = {}) => {
      if (!tableId || typeof tableId !== 'string') return
      const removed = removeTableWatcher(tableId, socket.id)
      socket.leave(`table:${tableId}`)
      _clearDemoTimer(socket.id, tableId)
      if (removed) broadcastTablePresence(io, tableId)
    })

    // ── User-specific room ──────────────────────────────────────────
    // Joins a `user:${id}` room so journeyService can push guide:journeyStep
    // events to this user's connected sockets. All other Tier 2 notifications
    // flow through SSE; online presence is tracked via presenceStore.
    on('user:subscribe', async ({ authToken } = {}) => {
      const user = await resolveSocketUser(authToken)
      if (!user) return
      socket.join(`user:${user.id}`)
    })

    // ── Disconnect ──────────────────────────────────────────────────

    socket.on('disconnect', async () => {
      decrementSocket()
      cleanups.forEach(fn => fn())
      if (socket._trackedListenerCount !== 0) {
        logger.warn({ socketId: socket.id, remaining: socket._trackedListenerCount }, 'socket disconnected with uncleaned listeners')
      }
      logger.info({ socketId: socket.id }, 'socket disconnected')

      // Phase 3.1: drop from table presence
      const droppedFromTables = removeWatcherFromAllTables(socket.id)
      for (const tableId of droppedFromTables) {
        broadcastTablePresence(io, tableId)
      }
      _clearAllDemoTimers(socket.id)

      // Bot game spectator + pong cleanup
      botGameRunner.removeSpectator(socket.id)
      pongRunner.removeSocket(socket.id)

      // Handle table disconnect
      const tableId = _socketToTable.get(socket.id)
      if (!tableId) return

      let table
      try {
        table = await db.table.findUnique({ where: { id: tableId } })
      } catch (_) {
        unregisterSocket(socket.id)
        return
      }
      if (!table) {
        unregisterSocket(socket.id)
        return
      }

      const seats = table.seats || []
      const ps = table.previewState || {}
      const myUserId = findUserIdForSocket(socket.id, tableId, seats)
      const isPlayer = seats.some(s => s.userId === myUserId && s.status === 'occupied')

      if (!isPlayer) {
        // Spectator left — clean up and update count
        _spectatorSockets.delete(socket.id)
        unregisterSocket(socket.id)
        clearIdleTimer(socket.id)
        broadcastTablePresence(io, tableId)
        return
      }

      if (table.status === 'FORMING') {
        // Host left before anyone joined — close immediately and free seats
        await db.table.update({
          where: { id: tableId },
          data:  { status: 'COMPLETED', seats: releaseSeats(table.seats) },
        }).catch(() => {})
        dispatchTableReleased(tableId, TABLE_RELEASED_REASONS.DISCONNECT, { trigger: 'disconnect-forming' })
        await deleteIfGuestTable(table)
        if (table.tournamentMatchId) {
          // For tournament matches: reset slug so player 1 can rejoin after a
          // disconnect (e.g., brief network drop during page navigation).
          // Do NOT delete the pending match — both players still need to play.
          setPendingPvpMatchSlug(table.tournamentMatchId, null)
        }
        clearAllIdleTimersForTable(tableId)
        for (const [sid, tid] of _socketToTable) {
          if (tid === tableId) unregisterSocket(sid)
        }
        return
      }

      if (table.status === 'COMPLETED') {
        // Game already over — clean up the socket mapping and, if this is a
        // guest table (createdById === 'anonymous'), delete the row now that
        // the only player who could rematch it has left. The game-completion
        // path intentionally does NOT delete the row so in-session Rematch
        // still works.
        clearIdleTimer(socket.id)
        unregisterSocket(socket.id)
        // Free this player's seat — they've left a finished game. The other
        // player's seat stays occupied until they too disconnect or leave.
        if (myUserId) {
          await db.table.update({
            where: { id: tableId },
            data:  { seats: releaseSeatForUser(table.seats, myUserId) },
          }).catch((err) => logger.warn({ err: err.message, tableId }, 'disconnect-COMPLETED: failed to release seat'))
        }
        deleteIfGuestTable(table)
        return
      }

      // status === ACTIVE — start disconnect forfeit timer
      // Check if other player already disconnected
      const otherSeat = seats.find(s => s.userId !== myUserId && s.status === 'occupied')
      const otherUserId = otherSeat?.userId
      // Check if other player has a disconnect timer
      let otherDisconnected = false
      for (const [sid, info] of _disconnectTimers) {
        if (info.tableId === tableId && sid !== socket.id) {
          otherDisconnected = true
          clearTimeout(info.timerId)
          _disconnectTimers.delete(sid)
          break
        }
      }

      if (otherDisconnected) {
        // Both players disconnected — close immediately and free both seats
        await db.table.update({
          where: { id: tableId },
          data:  { status: 'COMPLETED', seats: releaseSeats(table.seats) },
        }).catch(() => {})
        dispatchTableReleased(tableId, TABLE_RELEASED_REASONS.DISCONNECT, { trigger: 'disconnect-both-gone' })
        await deleteIfGuestTable(table)
        if (table.tournamentMatchId) deletePendingPvpMatch(table.tournamentMatchId)
        clearAllIdleTimersForTable(tableId)
        for (const [sid, tid] of _socketToTable) {
          if (tid === tableId) unregisterSocket(sid)
        }
        return
      }

      // Notify the room that this player disconnected — dual-emit so SSE
      // spectators see the same overlay flip as legacy socket clients.
      const myMark = ps.marks?.[myUserId]
      dualEmitLifecycle(io, tableId, 'playerDisconnected', {
        mark: myMark,
        reconnectWindowMs: RECONNECT_WINDOW_MS,
      })

      // Start forfeit timer
      const timerId = setTimeout(async () => {
        _disconnectTimers.delete(socket.id)
        try {
          const t = await db.table.findUnique({ where: { id: tableId } })
          if (!t || t.status !== 'ACTIVE') return

          const tps = { ...t.previewState }
          const oppMark = myMark === 'X' ? 'O' : 'X'
          tps.winner = oppMark
          tps.scores[oppMark] = (tps.scores[oppMark] || 0) + 1

          // The disconnected player is gone — free their seat. The opponent
          // (still socket-connected) keeps theirs until they disconnect or
          // click Leave.
          const updated = await db.table.update({
            where: { id: tableId },
            data: {
              status: 'COMPLETED',
              previewState: tps,
              seats: releaseSeatForUser(t.seats, myUserId),
            },
          })

          io.to(`table:${tableId}`).emit('game:forfeit', {
            forfeiterMark: myMark,
            winner: oppMark,
            scores: tps.scores,
            reason: 'disconnect',
          })
          dispatchTableReleased(tableId, TABLE_RELEASED_REASONS.DISCONNECT, { trigger: 'disconnect-forfeit-timer' })
          broadcastTablePresence(io, tableId)  // F8

          recordPvpGame(updated, io).catch((err) => logger.warn({ err }, 'Failed to record disconnect forfeit'))
          deleteIfGuestTable(updated)
        } catch (err) {
          logger.warn({ err }, 'Disconnect forfeit timer error')
        }
      }, RECONNECT_WINDOW_MS)

      _disconnectTimers.set(socket.id, { tableId, timerId })
      clearIdleTimer(socket.id)
    })
  })

  botGameRunner.setIO(io)
  pongRunner.setIO(io)

  startSnapshotInterval()

  return io
}


// ── Bot move dispatch ────────────────────────────────────────────────────────

async function dispatchBotMove(table, io) {
  if (!table.isHvb || table.status !== 'ACTIVE') return

  const ps = table.previewState
  if (!ps) return

  let cellIndex
  try {
    if (table.botSkillId) {
      cellIndex = await getMoveForModel(table.botSkillId, ps.board)
    } else {
      cellIndex = minimaxMove(ps.board, 'master', ps.botMark)
    }
  } catch (err) {
    logger.warn({ err, tableId: table.id }, 'Bot move computation failed, falling back to minimax')
    cellIndex = minimaxMove(ps.board, 'master', ps.botMark)
  }

  // Apply bot move
  const fresh = await db.table.findUnique({ where: { id: table.id } })
  if (!fresh || fresh.status !== 'ACTIVE') return

  const fps = { ...fresh.previewState }
  const botMark = fps.botMark
  if (botMark !== fps.currentTurn) {
    logger.warn({ tableId: table.id }, 'makeBotMove: not bot turn')
    return
  }
  if (fps.board[cellIndex] !== null) {
    logger.warn({ tableId: table.id, cellIndex }, 'makeBotMove: cell occupied')
    return
  }

  fps.board[cellIndex] = botMark
  fps.moves = fps.moves || []
  fps.moves.push({ n: fps.moves.length + 1, m: botMark, c: cellIndex })

  const winner = getWinner(fps.board)
  const draw = !winner && isBoardFull(fps.board)

  let newStatus = 'ACTIVE'
  if (winner) {
    fps.winner = winner.mark ?? winner
    fps.winLine = winner.line ?? WIN_LINES.find(([a, b, c]) =>
      fps.board[a] === fps.winner && fps.board[b] === fps.winner && fps.board[c] === fps.winner
    ) ?? null
    const winMark = fps.winner
    fps.scores[winMark] = (fps.scores[winMark] || 0) + 1
    newStatus = 'COMPLETED'
  } else if (draw) {
    fps.winner = null
    newStatus = 'COMPLETED'
  } else {
    fps.currentTurn = botMark === 'X' ? 'O' : 'X'
  }

  const updated = await db.table.update({
    where: { id: table.id },
    data: { previewState: fps, status: newStatus },
  })

  io.to(`table:${table.id}`).emit('game:moved', {
    cellIndex,
    board: fps.board,
    currentTurn: fps.currentTurn,
    status: mapStatus(newStatus),
    winner: fps.winner,
    winLine: fps.winLine,
    scores: fps.scores,
    round: fps.round ?? 1,
  })

  if (newStatus === 'COMPLETED') {
    recordPvpGame(updated, io).catch((err) => logger.warn({ err }, 'Failed to record HvB game'))
    // Do NOT deleteIfGuestTable here — the guest-table row must persist so
    // the player can Rematch. The disconnect handler cleans it up when the
    // socket closes; the 24h tableGcService sweep is the backstop. (Matches
    // the fix applied in the main game:moved completion branch.)
  }
}

// ── Record PvP game ──────────────────────────────────────────────────────────

async function recordPvpGame(table, io) {
  const seats = table.seats || []
  const ps = table.previewState || {}
  const marks = ps.marks || {}

  // Seats store betterAuthId. Resolve domain User.ids for DB writes (Game FK).
  const hostBaId = hostUserId(seats)    // betterAuthId from seat 0
  const guestBaId = guestUserId(seats)  // betterAuthId from seat 1

  if (!hostBaId && !guestBaId) return
  // No moves played — nothing worth recording (abandoned / forfeited before start).
  const moveCount = (ps.board || []).filter(Boolean).length
  if (moveCount === 0) return

  // Resolve domain User.ids (needed for createGame, ELO, tournament participant)
  const [hostUser, guestUser] = await Promise.all([
    hostBaId  ? db.user.findUnique({ where: { betterAuthId: hostBaId },  select: { id: true } }) : null,
    guestBaId ? db.user.findUnique({ where: { betterAuthId: guestBaId }, select: { id: true } }) : null,
  ])
  const hostDomainId  = hostUser?.id  ?? null
  const guestDomainId = guestUser?.id ?? null

  if (!hostDomainId && !guestDomainId) return

  const isTournamentRoom = !!table.tournamentMatchId
  const totalMoves = (ps.board || []).filter(Boolean).length
  const createdMs = new Date(table.createdAt).getTime()
  const updatedMs = new Date(table.updatedAt).getTime()
  const durationMs = updatedMs - createdMs

  // Determine outcome from winner mark
  let outcome = 'DRAW'
  if (ps.winner) {
    const winnerIsHost = marks[hostBaId] === ps.winner
    outcome = winnerIsHost ? 'PLAYER1_WIN' : 'PLAYER2_WIN'
  }

  // Determine winnerId (domain User.id for Game FK)
  let winnerId = null
  if (ps.winner) {
    const winnerBaId = userIdForMark(marks, ps.winner)
    if (winnerBaId === hostBaId) winnerId = hostDomainId
    else if (winnerBaId === guestBaId) winnerId = guestDomainId
  }

  // Record game — uses domain User.ids for FK references
  if (hostDomainId) {
    await createGame({
      player1Id: hostDomainId,
      player2Id: guestDomainId,
      winnerId,
      mode: table.isHvb ? 'HVB' : 'HVH',
      outcome,
      totalMoves,
      durationMs,
      startedAt: new Date(table.createdAt),
      roomName: null,
      tournamentId: table.tournamentId ?? null,
      tournamentMatchId: table.tournamentMatchId ?? null,
      moveStream: ps.moves?.length ? ps.moves : null,
    })
  }

  // Journey step 1 (Hook: Play a PvAI game) — only fires for human-vs-bot
  // table games. PvP games don't qualify for Hook step 1 in the new spec
  // (Hook is specifically about demonstrating bots-as-first-class-players).
  // Uses domain User.id.
  if (hostDomainId && table.isHvb) completeJourneyStep(hostDomainId, 1, io).catch(() => {})

  // ELO update (skip for tournament and HvB) — uses domain User.id
  if (!isTournamentRoom && !table.isHvb && hostDomainId && guestDomainId) {
    updatePlayersEloAfterPvP(hostDomainId, guestDomainId, outcome).catch(() => {})
  }

  // Tournament series completion check
  if (isTournamentRoom) {
    const xWins = ps.scores?.X ?? 0
    const oWins = ps.scores?.O ?? 0
    const gamesPlayed = ps.round ?? 1
    const drawGames = gamesPlayed - xWins - oWins
    const bestOfN = table.bestOfN ?? 1
    const required = Math.ceil(bestOfN / 2)
    // Majority reached OR max games played (prevents infinite draws in TTT
    // where two optimal players will draw every game). If max games reached
    // with neither side at `required`, the side with more wins takes the
    // series; if tied on wins, X (host) wins as the default tiebreaker.
    const majorityReached = xWins >= required || oWins >= required
    const maxGamesReached = gamesPlayed >= bestOfN
    const seriesDone = majorityReached || maxGamesReached
    logger.info({ tableId: table.id, tournamentMatchId: table.tournamentMatchId, bestOfN, xWins, oWins, required, gamesPlayed, majorityReached, maxGamesReached, seriesDone }, 'tournament series check')

    if (seriesDone) {
      const seriesWinnerMark = xWins >= oWins ? 'X' : 'O'
      const seriesWinnerBaId = userIdForMark(marks, seriesWinnerMark) // betterAuthId from marks

      // Tournament participant lookup needs domain User.id
      let winnerParticipantId = null
      try {
        const winnerUser = seriesWinnerBaId
          ? await db.user.findUnique({ where: { betterAuthId: seriesWinnerBaId }, select: { id: true } })
          : null
        const participant = winnerUser
          ? await db.tournamentParticipant.findFirst({
              where: { tournamentId: table.tournamentId, userId: winnerUser.id },
              select: { id: true },
            })
          : null
        winnerParticipantId = participant?.id ?? null
      } catch (err) {
        logger.warn({ err, tournamentMatchId: table.tournamentMatchId }, 'Could not look up winner participant ID')
      }

      const completed = await completeTournamentMatch(table.tournamentMatchId, winnerParticipantId, xWins, oWins, drawGames)
      if (completed) deletePendingPvpMatch(table.tournamentMatchId)

      const seriesPayload = {
        tournamentId: table.tournamentId,
        matchId: table.tournamentMatchId,
        p1Wins: xWins,
        p2Wins: oWins,
        seriesWinnerUserId: seriesWinnerBaId,
      }
      io.to(`table:${table.id}`).emit('tournament:series:complete', seriesPayload)
      // Phase 3 SSE dual-emit on the tournament prefix so the tournament
      // detail page receives series completion without a socket connection.
      appendToStream(`tournament:${table.tournamentId}:series:complete`, seriesPayload).catch(() => {})
    } else {
      // Mid-series: persist the current score so the bracket updates live.
      db.tournamentMatch.update({
        where: { id: table.tournamentMatchId },
        data: { p1Wins: xWins, p2Wins: oWins, drawGames, status: 'IN_PROGRESS' },
      }).catch(err => logger.warn({ err, tournamentMatchId: table.tournamentMatchId }, 'Failed to update mid-series score'))

      const scorePayload = {
        tournamentId: table.tournamentId,
        matchId: table.tournamentMatchId,
        p1Wins: xWins,
        p2Wins: oWins,
      }
      io.emit('tournament:match:score', scorePayload)
      appendToStream('tournament:match:score', scorePayload).catch(() => {})
    }
    return
  }

  // Record credits and emit accomplishments (free-play only) — domain User.ids
  const pvpParticipants = [
    hostDomainId  ? { userId: hostDomainId,  isBot: false, botOwnerId: null } : null,
    guestDomainId ? { userId: guestDomainId, isBot: table.isHvb ?? false, botOwnerId: null } : null,
  ].filter(Boolean)

  if (pvpParticipants.length > 0) {
    recordGameCompletion({ appId: 'xo-arena', participants: pvpParticipants, mode: table.isHvb ? 'hvb' : 'hvh' })
      .catch((err) => logger.warn({ err }, 'Credit recording failed (non-fatal)'))
    // TODO: surface achievement/tier notifications via notificationBus.dispatch
    // once an appropriate REGISTRY entry exists. The prior socket emits
    // (accomplishment, guide:notification) had no listeners after Phase D.
  }
}

function parseRedisUrl(url) {
  const u = new URL(url)
  return { host: u.hostname, port: parseInt(u.port) || 6379 }
}
