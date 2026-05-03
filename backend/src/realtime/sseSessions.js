// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * sseSessions — registry of live SSE connections keyed by sseSessionId.
 *
 * Each open `/api/v1/events/stream` connection mints a `sseSessionId`
 * (server-side nanoid) sent to the client as the first SSE frame. The client
 * echoes it on every `/api/v1/rt/*` POST via `X-SSE-Session: <id>`. This
 * registry is the single source of truth for "is this session still live"
 * and what tables/pong rooms it has joined — replacing the per-`socket.id`
 * maps in socketHandler.js (`_socketToTable`, `_spectatorSockets`, etc.) for
 * the SSE+POST transport.
 *
 * Disposal is debounced: a tab refresh closes the SSE stream and reopens it
 * within ~2 seconds. We give it a short grace period so the brief gap
 * doesn't trigger forfeits or presence churn. If a new session arrives for
 * the same userId before the timer fires, the disposal is cancelled.
 *
 * The registry is in-process. Cross-process fanout still happens via Redis
 * Streams (sseBroker reads from there). Sessions are fundamentally tied to
 * a single open connection, so per-process state is correct.
 */

const DISPOSE_DEBOUNCE_MS = 3_000

// sseSessionId → { userId, res, joinedTables: Set<string>, joinedPongRooms: Set<string>, lastSeenAt }
const _sessions = new Map()

// userId → Set<sseSessionId>  (reverse index for forUser() and grace-window cancellation)
const _byUser = new Map()

// userId → { timerId, victims: Set<sseSessionId> }  (pending dispose timers,
// keyed by user so a fresh SSE for the same user cancels the disposal)
const _pendingDispose = new Map()

// sseSessionId → fn(userId, sessionId)  (caller-supplied cleanup, e.g.
// "release table seats". Fires after the debounce window expires.)
const _onDispose = new Map()

function _addToUserIndex(sessionId, userId) {
  if (!userId) return
  let set = _byUser.get(userId)
  if (!set) { set = new Set(); _byUser.set(userId, set) }
  set.add(sessionId)
}
function _removeFromUserIndex(sessionId, userId) {
  if (!userId) return
  const set = _byUser.get(userId)
  if (!set) return
  set.delete(sessionId)
  if (set.size === 0) _byUser.delete(userId)
}

/**
 * Register a new SSE session.
 *
 * `onDispose(userId, sessionId)` runs once after the debounce expires (i.e.
 * the user really left). It does not run for a same-user reconnect.
 */
export function register(sessionId, { userId = null, res = null, onDispose = null } = {}) {
  _sessions.set(sessionId, {
    userId,
    res,
    joinedTables:    new Set(),
    joinedPongRooms: new Set(),
    lastSeenAt:      Date.now(),
  })
  _addToUserIndex(sessionId, userId)
  if (onDispose) _onDispose.set(sessionId, onDispose)

  // Fresh connection for this user — cancel any pending disposal, since the
  // user just came back (tab refresh, network blip).
  if (userId && _pendingDispose.has(userId)) {
    const { timerId } = _pendingDispose.get(userId)
    clearTimeout(timerId)
    _pendingDispose.delete(userId)
  }
}

/**
 * Schedule disposal of a session after a debounce window. If a new session
 * for the same userId arrives before the window elapses, the disposal is
 * cancelled (treat as a reconnect). Otherwise the registered onDispose
 * callback fires and the session entry is removed.
 */
export function dispose(sessionId, { immediate = false } = {}) {
  const entry = _sessions.get(sessionId)
  if (!entry) return
  const { userId } = entry

  const finish = () => {
    const onDispose = _onDispose.get(sessionId)
    // Snapshot membership before deleting the entry so callers (Phase 7e
    // disconnect-forfeit) can act on the tables/pong rooms this session was
    // last in, rather than re-querying after the entry is gone.
    const joinedTables    = entry?.joinedTables    ? [...entry.joinedTables]    : []
    const joinedPongRooms = entry?.joinedPongRooms ? [...entry.joinedPongRooms] : []
    _sessions.delete(sessionId)
    _removeFromUserIndex(sessionId, userId)
    _onDispose.delete(sessionId)
    if (userId) _pendingDispose.delete(userId)
    try { onDispose?.(userId, sessionId, { joinedTables, joinedPongRooms }) } catch {}
  }

  if (immediate || !userId) {
    finish()
    return
  }

  // Debounce per user. If the user has multiple tabs open, each tab disposes
  // independently — but if a fresh tab opens for this same user during the
  // window, register() above clears the pending timer.
  const existing = _pendingDispose.get(userId)
  if (existing) clearTimeout(existing.timerId)
  const timerId = setTimeout(finish, DISPOSE_DEBOUNCE_MS)
  _pendingDispose.set(userId, { timerId })
}

export function get(sessionId) {
  return _sessions.get(sessionId) || null
}

export function forUser(userId) {
  const set = _byUser.get(userId)
  if (!set) return []
  return [..._byUser.get(userId)].map(sid => ({ sessionId: sid, ...(_sessions.get(sid) || {}) }))
}

export function joinTable(sessionId, tableId) {
  const entry = _sessions.get(sessionId)
  if (!entry) return false
  entry.joinedTables.add(tableId)
  entry.lastSeenAt = Date.now()
  return true
}

export function leaveTable(sessionId, tableId) {
  const entry = _sessions.get(sessionId)
  if (!entry) return false
  entry.joinedTables.delete(tableId)
  return true
}

export function tablesFor(sessionId) {
  const entry = _sessions.get(sessionId)
  return entry ? [...entry.joinedTables] : []
}

export function joinPongRoom(sessionId, slug) {
  const entry = _sessions.get(sessionId)
  if (!entry) return false
  entry.joinedPongRooms.add(slug)
  return true
}

export function leavePongRoom(sessionId, slug) {
  const entry = _sessions.get(sessionId)
  if (!entry) return false
  entry.joinedPongRooms.delete(slug)
  return true
}

export function pongRoomsFor(sessionId) {
  const entry = _sessions.get(sessionId)
  return entry ? [...entry.joinedPongRooms] : []
}

export function touch(sessionId) {
  const entry = _sessions.get(sessionId)
  if (entry) entry.lastSeenAt = Date.now()
}

export function totalSessions() { return _sessions.size }

// Test hook — flushes everything. Not used in prod.
export function _resetForTests() {
  for (const { timerId } of _pendingDispose.values()) clearTimeout(timerId)
  _sessions.clear()
  _byUser.clear()
  _pendingDispose.clear()
  _onDispose.clear()
}

// Re-exported so tests can assert behavior at the boundary without importing
// a magic number. Not used by production code paths.
export const _DISPOSE_DEBOUNCE_MS = DISPOSE_DEBOUNCE_MS
