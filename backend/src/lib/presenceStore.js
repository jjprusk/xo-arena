// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Heartbeat-based online presence — Tier 2.
 *
 * Each signed-in client POSTs /api/v1/presence/heartbeat every HEARTBEAT_MS.
 * The server keeps a userId → expiresAt map; a sweeper runs every 10s and
 * removes entries past their TTL, then emits a `presence:changed` hint via
 * the Tier 2 event stream so SSE subscribers can refetch `/presence/online`.
 *
 * Why heartbeat + expiry instead of socket-room membership:
 *   - Socket membership conflated three different concerns (auth, presence,
 *     per-user notification delivery) and was the source of the "online
 *     users stays stale after tab close" class of bugs.
 *   - With REST heartbeats, the source of truth is the DB-adjacent in-memory
 *     map on one process. No reconnect logic to get wrong.
 *   - Horizontal scale is handled the same way as before: each backend
 *     instance tracks its own local map + broadcasts membership deltas via
 *     Redis. Clients see the union via the Tier 2 stream.
 *
 * TTL: 45s. Heartbeat interval on the client is 15s — 3× window gives headroom
 * for packet loss / focus-pause without falsely dropping the user.
 */
import { appendToStream } from './eventStream.js'
import logger from '../logger.js'

const HEARTBEAT_TTL_MS = 45_000
const SWEEP_INTERVAL_MS = 10_000

// userId → { displayName, isBot, expiresAt }
const _online = new Map()

function scheduleSweeper() {
  if (_sweeperTimer) return
  _sweeperTimer = setInterval(() => {
    const now = Date.now()
    const expired = []
    for (const [userId, entry] of _online) {
      if (entry.expiresAt <= now) expired.push(userId)
    }
    if (expired.length) {
      for (const uid of expired) _online.delete(uid)
      // Hint to SSE subscribers: membership changed, go fetch /online.
      appendToStream('presence:changed', { removed: expired.length }).catch(() => {})
    }
  }, SWEEP_INTERVAL_MS)
  _sweeperTimer.unref?.()
}
let _sweeperTimer = null

/**
 * Record a heartbeat from a user. Returns true if this is a new entry
 * (triggers a presence:changed broadcast), false if it's just a refresh.
 */
export function recordHeartbeat(userId, { displayName = null, isBot = false } = {}) {
  if (!userId) return false
  scheduleSweeper()
  const wasPresent = _online.has(userId)
  _online.set(userId, {
    displayName,
    isBot,
    expiresAt: Date.now() + HEARTBEAT_TTL_MS,
  })
  if (!wasPresent) {
    appendToStream('presence:changed', { joined: userId }).catch(() => {})
  }
  return !wasPresent
}

/**
 * Snapshot of all currently-online users. Callers use this to satisfy
 * `GET /api/v1/presence/online`.
 */
export function getOnline() {
  const now = Date.now()
  const users = []
  for (const [userId, entry] of _online) {
    if (entry.expiresAt <= now) continue  // lazy expire (sweeper also runs)
    users.push({ userId, displayName: entry.displayName, isBot: !!entry.isBot })
  }
  return users
}

export function getOnlineCount() { return getOnline().length }

// Test hook — clears state.
export function _resetForTests() {
  _online.clear()
  if (_sweeperTimer) { clearInterval(_sweeperTimer); _sweeperTimer = null }
}
