// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Minimal in-process TTL cache.
 *
 * Keyed by string. Values are evicted lazily on read or eagerly via
 * invalidate(). No external dependencies — just a Map.
 *
 * Usage:
 *   import cache from '../utils/cache.js'
 *
 *   const data = cache.get('leaderboard:all:all:50:false')
 *   if (!data) {
 *     const fresh = await expensiveQuery()
 *     cache.set('leaderboard:all:all:50:false', fresh, 60_000)
 *   }
 *
 *   cache.invalidate('leaderboard:all:all:50:false')   // one key
 *   cache.invalidatePrefix('leaderboard:')              // all leaderboard variants
 */

const store = new Map()  // key → { value, expiresAt }

function get(key) {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  return entry.value
}

function set(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

function invalidate(key) {
  store.delete(key)
}

/** Delete all keys that start with the given prefix. */
function invalidatePrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

function clear() {
  store.clear()
}

/** Current number of live (non-expired) entries — useful for tests. */
function size() {
  const now = Date.now()
  let count = 0
  for (const entry of store.values()) {
    if (now <= entry.expiresAt) count++
  }
  return count
}

export default { get, set, invalidate, invalidatePrefix, clear, size }
