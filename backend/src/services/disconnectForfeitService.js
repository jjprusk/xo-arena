// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * disconnectForfeitService — SSE+POST counterpart to socketHandler's
 * `_disconnectTimers` / `socket.on('disconnect')` flow.
 *
 * Wired into `sseSessions.dispose` via the onDispose callback in
 * `routes/events.js`. Once the 3-second per-user dispose debounce expires
 * without a fresh SSE for that user, this service walks the tables the
 * session was joined to and applies the same lifecycle the legacy socket
 * handler did:
 *
 *   FORMING   → close the table immediately (host left before guest joined).
 *   ACTIVE    → emit `playerDisconnected` lifecycle, schedule a 60-second
 *               forfeit timer. If the opponent had a pending timer, both
 *               sides are gone — close immediately.
 *   COMPLETED → free the leaver's seat.
 *
 * `cancelForfeitFor({ seatId, tableId })` is called by `routes/realtime.js`
 * when a user re-attaches to a table they had a pending timer for, matching
 * the socket handler's behavior when a fresh socket reconnects mid-window.
 *
 * The 3-second sse debounce + 60-second forfeit window stack: the user gets
 * 63s of grace before the game is awarded to their opponent, which is
 * materially better than the socket-only path's 60s flat.
 */
import db from '../lib/db.js'
import logger from '../logger.js'
import * as sseSessions from '../realtime/sseSessions.js'
import { releaseSeats, releaseSeatForUser } from '../lib/tableSeats.js'
import { dispatchTableReleased, TABLE_RELEASED_REASONS } from '../lib/tableReleased.js'
import { deletePendingPvpMatch, setPendingPvpMatchSlug } from '../lib/tournamentBridge.js'
import { dualEmitLifecycle } from './tablePresenceService.js'
import { appendToStream } from '../lib/eventStream.js'

const RECONNECT_WINDOW_MS = 60_000

// `${seatId}|${tableId}` → { timerId, mark } pending forfeit timers. Keyed
// by the seat identity (BA id for signed-in, `guest:<sessionId>` for guests)
// so a same-user reconnect can find and cancel them.
const _forfeitTimers = new Map()
function timerKey(seatId, tableId) { return `${seatId}|${tableId}` }

/**
 * Apply the forfeit lifecycle to an ACTIVE table for a known seat — the
 * shared body used by:
 *
 *   - the post-disconnect 60-second timer below (`reason: 'disconnect'`)
 *   - the idle-timeout subsystem (`reason: 'idle'`) once the warn + grace
 *     window expires for an inactive player
 *
 * No `userStillAtTable` short-circuit here: callers above this layer have
 * already decided a forfeit is warranted. Returns `{ ok, code? }`.
 */
export async function applyForfeit({ io, seatId, tableId, mark, reason = 'disconnect' }) {
  const t = await db.table.findUnique({ where: { id: tableId } })
  if (!t || t.status !== 'ACTIVE') return { ok: false, code: 'NOT_ACTIVE' }

  const tps     = { ...t.previewState }
  const myMark  = mark || tps.marks?.[seatId]
  if (!myMark) return { ok: false, code: 'NO_MARK' }
  const oppMark = myMark === 'X' ? 'O' : 'X'
  tps.winner = oppMark
  tps.scores = { ...(tps.scores || {}) }
  tps.scores[oppMark] = (tps.scores[oppMark] || 0) + 1

  const updated = await db.table.update({
    where: { id: tableId },
    data:  {
      status:       'COMPLETED',
      previewState: tps,
      seats:        releaseSeatForUser(t.seats, seatId),
    },
  })

  const forfeitPayload = { forfeiterMark: myMark, winner: oppMark, scores: tps.scores, reason }
  if (io) io.to(`table:${tableId}`).emit('game:forfeit', forfeitPayload)
  appendToStream(
    `table:${tableId}:state`,
    { kind: 'forfeit', ...forfeitPayload },
    { userId: '*' },
  ).catch(() => {})

  dispatchTableReleased(tableId, TABLE_RELEASED_REASONS.DISCONNECT, { trigger: `forfeit-${reason}` })

  // Best-effort recordPvpGame — pulled lazily to avoid a circular import
  // (socketHandler → sseSessions → disconnectForfeitService → socketHandler).
  try {
    const { recordPvpGame } = await import('../realtime/socketHandler.js')
    recordPvpGame(updated, io).catch(err =>
      logger.warn({ err: err.message }, `recordPvpGame after ${reason} forfeit failed`),
    )
  } catch (err) {
    logger.warn({ err: err.message }, `recordPvpGame import failed in ${reason} forfeit`)
  }

  if (updated.createdById === 'anonymous') {
    await db.table.delete({ where: { id: tableId } }).catch(() => {})
  }
  // Tear down any idle timers still armed against this table. The forfeiter's
  // timer is usually already gone (this is being called from inside it, or
  // from a disconnect path that fired cancelAllForUser); the *opponent*'s
  // timer is the one that would otherwise fire later, find a COMPLETED
  // table, and log a NOT_ACTIVE no-op. Cheaper to clear up-front.
  try {
    const { cancelAllForTable } = await import('../realtime/idleTimers.js')
    cancelAllForTable(tableId)
  } catch { /* idleTimers optional */ }
  return { ok: true, mark: myMark, oppMark, scores: tps.scores }
}

/** Resolve the seat (BA id for signed-in, `guest:<sessionId>` for guests)
 *  the given user holds at the table, or null. Exposed so other modules
 *  (idleTimers) can run the forfeit path without re-implementing seat
 *  resolution. */
export async function resolveSeatIdForUser({ userId, sessionId = null, tableId }) {
  const table = await db.table.findUnique({ where: { id: tableId } })
  if (!table) return null
  return resolveSeatId({ userId, sessionId, table })
}

/** Clear a pending forfeit timer for this seat at this table.
 *  Returns true if a timer was cancelled. */
export function cancelForfeitFor({ seatId, tableId }) {
  if (!seatId || !tableId) return false
  const k = timerKey(seatId, tableId)
  const e = _forfeitTimers.get(k)
  if (!e) return false
  clearTimeout(e.timerId)
  _forfeitTimers.delete(k)
  return true
}

/** True if `userId` has any OTHER live SSE session (not `exceptSessionId`)
 *  with `tableId` in its joinedTables — i.e., the user is still represented
 *  at the table and we should NOT fire the disconnect logic. */
function userStillAtTable(userId, tableId, exceptSessionId) {
  if (!userId) return false
  const sessions = sseSessions.forUser(userId)
  for (const s of sessions) {
    if (s.sessionId === exceptSessionId) continue
    const tables = s.joinedTables
    if (tables instanceof Set && tables.has(tableId)) return true
  }
  return false
}

/** Resolve which seat (by seatId stored on the table) this disposed session
 *  held. Guests are derivable directly; signed-in users need a User lookup
 *  to map domain id → BA id. Returns null if no matching occupied seat. */
async function resolveSeatId({ userId, sessionId, table }) {
  const seats = table.seats || []
  const guestSeatId = `guest:${sessionId}`
  if (seats.some(s => s?.userId === guestSeatId && s?.status === 'occupied')) {
    return guestSeatId
  }
  if (userId) {
    const u = await db.user.findUnique({
      where:  { id: userId },
      select: { betterAuthId: true },
    }).catch(() => null)
    const baId = u?.betterAuthId
    if (baId && seats.some(s => s?.userId === baId && s?.status === 'occupied')) return baId
  }
  return null
}

/** Entry point — invoked from `sseSessions.dispose` onDispose callback after
 *  the 3-second debounce expires. Walks each table the session was joined to
 *  and applies the disconnect-forfeit lifecycle. */
export async function handleDisconnect({ io, userId, sessionId, tablesGone }) {
  if (!Array.isArray(tablesGone) || tablesGone.length === 0) return
  for (const tableId of tablesGone) {
    try {
      await processTable({ io, userId, sessionId, tableId })
    } catch (err) {
      logger.warn({ err: err.message, tableId, sessionId }, 'disconnectForfeit: processTable failed')
    }
  }
}

async function processTable({ io, userId, sessionId, tableId }) {
  if (userStillAtTable(userId, tableId, sessionId)) return

  const table = await db.table.findUnique({ where: { id: tableId } })
  if (!table) return

  const seatId = await resolveSeatId({ userId, sessionId, table })
  if (!seatId) return

  if (table.status === 'FORMING') {
    await db.table.update({
      where: { id: tableId },
      data:  { status: 'COMPLETED', seats: releaseSeats(table.seats) },
    }).catch(() => {})
    dispatchTableReleased(tableId, TABLE_RELEASED_REASONS.DISCONNECT, { trigger: 'sse-disconnect-forming' })
    if (table.createdById === 'anonymous') {
      await db.table.delete({ where: { id: tableId } }).catch(() => {})
    }
    if (table.tournamentMatchId) setPendingPvpMatchSlug(table.tournamentMatchId, null)
    dualEmitLifecycle(io, tableId, 'cancelled')
    return
  }

  if (table.status === 'COMPLETED') {
    await db.table.update({
      where: { id: tableId },
      data:  { seats: releaseSeatForUser(table.seats, seatId) },
    }).catch(() => {})
    return
  }

  // ── ACTIVE ───────────────────────────────────────────────────────────────
  const ps = table.previewState || {}
  const myMark = ps.marks?.[seatId]
  if (!myMark) return  // not actually a player — nothing to forfeit

  // Both-gone: if the opponent already has a pending forfeit timer, the table
  // closes immediately and both seats are released.
  const seats = table.seats || []
  const otherSeat = seats.find(s => s?.userId !== seatId && s?.status === 'occupied')
  if (otherSeat?.userId) {
    const otherEntry = _forfeitTimers.get(timerKey(otherSeat.userId, tableId))
    if (otherEntry) {
      clearTimeout(otherEntry.timerId)
      _forfeitTimers.delete(timerKey(otherSeat.userId, tableId))
      await db.table.update({
        where: { id: tableId },
        data:  { status: 'COMPLETED', seats: releaseSeats(table.seats) },
      }).catch(() => {})
      dispatchTableReleased(tableId, TABLE_RELEASED_REASONS.DISCONNECT, { trigger: 'sse-disconnect-both-gone' })
      if (table.createdById === 'anonymous') {
        await db.table.delete({ where: { id: tableId } }).catch(() => {})
      }
      if (table.tournamentMatchId) deletePendingPvpMatch(table.tournamentMatchId)
      return
    }
  }

  dualEmitLifecycle(io, tableId, 'playerDisconnected', {
    mark: myMark,
    reconnectWindowMs: RECONNECT_WINDOW_MS,
  })

  const k = timerKey(seatId, tableId)
  const existing = _forfeitTimers.get(k)
  if (existing) clearTimeout(existing.timerId)

  const timerId = setTimeout(async () => {
    _forfeitTimers.delete(k)
    try {
      await applyForfeit({ io, seatId, tableId, mark: myMark, reason: 'disconnect' })
    } catch (err) {
      logger.warn({ err: err.message, tableId }, 'sse disconnect forfeit timer error')
    }
  }, RECONNECT_WINDOW_MS)

  _forfeitTimers.set(k, { timerId, mark: myMark })
}

// Exposed for tests + assertions in routes that want to know whether a timer
// is pending (e.g. to short-circuit a "you have a pending forfeit, rejoin
// resets it" UX in the future).
export function _hasPendingForfeit({ seatId, tableId }) {
  return _forfeitTimers.has(timerKey(seatId, tableId))
}

export const _RECONNECT_WINDOW_MS = RECONNECT_WINDOW_MS

export function _resetForTests() {
  for (const { timerId } of _forfeitTimers.values()) clearTimeout(timerId)
  _forfeitTimers.clear()
}
