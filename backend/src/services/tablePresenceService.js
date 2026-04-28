// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * tablePresenceService — transport-agnostic table presence + lifecycle.
 *
 * Phase 5 of the Realtime Migration (Realtime_Migration_Plan.md) extracts
 * the table:watch / table:unwatch handlers and the room:* lifecycle emits
 * from socketHandler.js so both Socket.io and SSE+POST share the same
 * service code.
 *
 * What lives here:
 *   - `dualEmitPresence(io, tableId, presence, spectatorCount)` — emits
 *     `table:presence` to the socket.io room AND appends the same payload
 *     to the SSE channel `table:<id>:presence` (broadcast to all watchers).
 *   - `dualEmitLifecycle(io, tableId, kind, payload)` — emits `room:<kind>`
 *     to the socket.io room AND appends `{kind, ...payload}` to the SSE
 *     channel `table:<id>:lifecycle`. Targeted-to-socket variants are
 *     handled by `dualEmitLifecycleToSocket`.
 *   - `watchForSession({ tableId, sessionId, user })` — the SSE+POST
 *     equivalent of the legacy `table:watch` handler body. Adds the
 *     watcher to the in-memory presence map, fires the spectator.joined
 *     bus event, and starts the demo Hook step-2 credit timer if the
 *     table is a demo.
 *   - `unwatchForSession({ tableId, sessionId })` — DELETE counterpart.
 *   - `handleSessionGone({ sessionId })` — called from sseSessions.onDispose
 *     to drop a session from every table it was watching and clear demo
 *     timers. Returns the affected tableIds so callers can rebroadcast.
 *
 * Watcher keys: socket.id and sseSessionId share the same in-memory
 * `tablePresence` map. They are different namespaces (Socket.io socket.id
 * is a 20-char string, sseSessionId is nanoid(16)) and never collide; no
 * prefix is needed.
 */
import {
  addWatcher,
  removeWatcher,
  removeWatcherFromAllTables,
} from '../realtime/tablePresence.js'
import { appendToStream } from '../lib/eventStream.js'
import { dispatch as dispatchBus } from '../lib/notificationBus.js'
import { completeStep as completeJourneyStep } from './journeyService.js'
import db from '../lib/db.js'
import logger from '../logger.js'

const DEMO_WATCH_THRESHOLD_MS = 2 * 60 * 1000  // 2 min — Hook step 2 credit

// watcherId → Map<tableId, NodeJS.Timeout>  (demo Hook step 2 credit timers)
// Keyed identically to the watcher map; cleared on unwatch / session gone.
const _demoTimers = new Map()

function clearDemoTimer(watcherId, tableId) {
  const m = _demoTimers.get(watcherId)
  if (!m) return
  const t = m.get(tableId)
  if (t) {
    clearTimeout(t)
    m.delete(tableId)
  }
  if (m.size === 0) _demoTimers.delete(watcherId)
}

function clearAllDemoTimers(watcherId) {
  const m = _demoTimers.get(watcherId)
  if (!m) return
  for (const t of m.values()) clearTimeout(t)
  _demoTimers.delete(watcherId)
}

function startDemoTimer(watcherId, tableId, userId) {
  let m = _demoTimers.get(watcherId)
  if (!m) { m = new Map(); _demoTimers.set(watcherId, m) }
  if (m.has(tableId)) return
  const timer = setTimeout(() => {
    completeJourneyStep(userId, 2).catch(() => {})
    m.delete(tableId)
    if (m.size === 0) _demoTimers.delete(watcherId)
  }, DEMO_WATCH_THRESHOLD_MS)
  m.set(tableId, timer)
}

/**
 * Emit `table:presence` to both Socket.io and SSE.
 *
 * Caller computes the spectatorCount because that lives in socketHandler's
 * legacy `_spectatorSockets` map for now (Phase 7 collapses it). The
 * function is safe to call with `io = null` (SSE-only).
 */
export function dualEmitPresence(io, tableId, presence, spectatorCount = 0) {
  const payload = { tableId, ...presence, spectatingCount: spectatorCount }
  if (io) io.to(`table:${tableId}`).emit('table:presence', payload)
  appendToStream(`table:${tableId}:presence`, payload, { userId: '*' }).catch(() => {})
  return payload
}

/**
 * Dual-emit a `room:<kind>` lifecycle event to both transports.
 *
 * Socket.io receives the legacy event name (`room:abandoned`, etc.) for
 * back-compat. SSE clients subscribe to the single `table:<id>:lifecycle`
 * channel and switch on `payload.kind` to route the same shapes.
 */
export function dualEmitLifecycle(io, tableId, kind, payload = {}) {
  if (io) io.to(`table:${tableId}`).emit(`room:${kind}`, payload)
  appendToStream(
    `table:${tableId}:lifecycle`,
    { kind, ...payload },
    { userId: '*' },
  ).catch(() => {})
}

/**
 * Add an SSE session as a watcher of a table.
 *
 * Returns `{ wasNew }` so the caller can decide whether to fire any
 * additional side-effects (e.g. log the join). The bus dispatch and demo
 * timer are handled here so the rt route stays a thin shell.
 */
export async function watchForSession({ tableId, sessionId, user }) {
  if (!tableId || !sessionId) return { wasNew: false }
  const wasNew = addWatcher(tableId, sessionId, {
    userId:      user?.id ?? null,
    displayName: user?.displayName ?? user?.username ?? null,
  })

  if (wasNew && user?.id) {
    try {
      const table = await db.table.findUnique({
        where:  { id: tableId },
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
      if (table?.isDemo) startDemoTimer(sessionId, tableId, user.id)
    } catch (err) {
      logger.warn({ err: err.message, tableId }, 'spectator cohort lookup failed (rt)')
    }
  }

  return { wasNew }
}

export function unwatchForSession({ tableId, sessionId }) {
  if (!tableId || !sessionId) return { removed: false }
  const removed = removeWatcher(tableId, sessionId)
  clearDemoTimer(sessionId, tableId)
  return { removed }
}

/**
 * Drop every table this session was watching. Called from sseSessions's
 * dispose callback after the 3-second debounce expires.
 *
 * Returns the affected tableIds; caller (socketHandler / route) is expected
 * to rebroadcast presence for each so the badge counts settle.
 */
export function handleSessionGone({ sessionId }) {
  if (!sessionId) return []
  const droppedFromTables = removeWatcherFromAllTables(sessionId)
  clearAllDemoTimers(sessionId)
  return droppedFromTables
}

// Test hook — flushes demo timers between tests. Production never calls this.
export function _resetForTests() {
  for (const m of _demoTimers.values()) {
    for (const t of m.values()) clearTimeout(t)
  }
  _demoTimers.clear()
}
