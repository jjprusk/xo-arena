// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Table presence tracking — Phase 3.1.
 *
 * In-memory map of who is *watching* (spectating) each Table. Wired into
 * socketHandler's table:watch / table:unwatch events; cleaned up on socket
 * disconnect.
 *
 * Logic is split out into pure helpers so the presence math can be tested
 * without spinning up socket.io.
 *
 * Phase 3.4 complete: Tables ARE the primitive. Seated players live in
 * db.table.seats; this presence map tracks spectators/watchers (socket-based,
 * not DB-persisted). The split between "seated" and "watching" remains.
 */

// tableId → Map<socketId, { userId: string|null, displayName: string|null }>
const _tableWatchers = new Map()

/**
 * Register a socket as a watcher of a table.
 * Idempotent: re-registering the same (tableId, socketId) overwrites the entry.
 *
 * @returns {boolean} true if this was a new watcher (count incremented),
 *                    false if the socket was already registered for this table
 */
export function addWatcher(tableId, socketId, watcher) {
  if (!tableId || !socketId) return false
  let watchers = _tableWatchers.get(tableId)
  if (!watchers) {
    watchers = new Map()
    _tableWatchers.set(tableId, watchers)
  }
  const wasNew = !watchers.has(socketId)
  watchers.set(socketId, {
    userId:      watcher?.userId      ?? null,
    displayName: watcher?.displayName ?? null,
  })
  return wasNew
}

/**
 * Remove a socket from a specific table's watcher list.
 *
 * @returns {boolean} true if a watcher was actually removed
 */
export function removeWatcher(tableId, socketId) {
  if (!tableId || !socketId) return false
  const watchers = _tableWatchers.get(tableId)
  if (!watchers) return false
  const removed = watchers.delete(socketId)
  if (removed && watchers.size === 0) _tableWatchers.delete(tableId)
  return removed
}

/**
 * Remove a socket from EVERY table it was watching. Called on disconnect.
 *
 * @returns {string[]} the tableIds that lost a watcher (caller broadcasts
 *                     updated counts to each)
 */
export function removeWatcherFromAllTables(socketId) {
  if (!socketId) return []
  const affected = []
  for (const [tableId, watchers] of _tableWatchers.entries()) {
    if (watchers.delete(socketId)) {
      affected.push(tableId)
      if (watchers.size === 0) _tableWatchers.delete(tableId)
    }
  }
  return affected
}

/**
 * Snapshot of the current watchers for a table.
 *
 * `count` is the number of unique *people* watching, not sockets:
 *   - authenticated watchers are deduped by userId (one person, many tabs → 1)
 *   - guest watchers are deduped by socketId (each tab counts once)
 *
 * This matches the user-facing mental model ("N people are watching") and
 * stops two pathological cases from inflating the badge:
 *   - refresh a tab: new socket arrives before the old one times out, so for
 *     ~45s there are two socketIds for one person. Without userId dedupe the
 *     count would jump up permanently until the old socket is detected gone
 *     (polling transport + default ping settings).
 *   - open N tabs as the same user: without dedupe, that person counts N
 *     times even though there's one human at a keyboard.
 *
 * `userIds` remains the de-duplicated set of authenticated userIds, used by
 * the detail page to render the "watching" list and by the spectator.joined
 * dispatch cohort.
 */
export function getPresence(tableId) {
  const watchers = _tableWatchers.get(tableId)
  if (!watchers || watchers.size === 0) return { count: 0, userIds: [] }
  const personIds = new Set()
  for (const [socketId, w] of watchers) {
    personIds.add(w.userId ?? `guest:${socketId}`)
  }
  const userIds = [...new Set(
    [...watchers.values()].map(w => w.userId).filter(Boolean),
  )]
  return { count: personIds.size, userIds }
}

/**
 * Return all tableIds currently being watched. Used by the periodic
 * re-broadcast and by tests.
 */
export function getActiveTableIds() {
  return [..._tableWatchers.keys()]
}

/**
 * Return the total number of watchers across all tables (counts every
 * socket, including multiple tabs from the same user). Used by the admin
 * health snapshot so the platform can see spectator load.
 */
export function getTotalWatchers() {
  let total = 0
  for (const watchers of _tableWatchers.values()) total += watchers.size
  return total
}

/**
 * Reset all presence state. Test-only — never call from production code.
 */
export function _resetForTests() {
  _tableWatchers.clear()
}
