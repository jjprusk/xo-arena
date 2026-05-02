// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * SSE broker — in-process fanout for the Tier 2 event stream.
 *
 * One shared Redis XREAD BLOCK loop reads `events:tier2:stream` in real
 * time. When a new entry arrives, it is dispatched to every locally-
 * registered SSE client, after filtering by target user and channel prefix.
 *
 * Why a shared XREAD loop instead of one Redis subscriber per client:
 *   - One connection to Redis regardless of the number of SSE clients.
 *   - XREAD BLOCK returns a natural stream id for every entry, so clients
 *     can use standard SSE Last-Event-ID semantics for reconnect replay.
 *   - Pubsub is still used elsewhere (tournamentBridge → socket.io). This
 *     broker is the SSE side — separate, additive, no interference.
 *
 * Client filtering:
 *   - Broadcast entries (userId='*') go to every registered client.
 *   - Personal entries (userId set) go only to the matching client.
 *   - `channels` filter on registration: if non-empty, dispatch only fires
 *     when the entry's channel starts with one of the registered prefixes
 *     (e.g. ['tournament:', 'guide:'] accepts 'tournament:started' and
 *     'guide:notification' but rejects 'pong:state').
 *
 * Disconnect handling: the endpoint passes the `res` object to `register`;
 * we unregister when the client closes (caller wires up res.on('close')).
 */
import Redis from 'ioredis'
import logger from '../logger.js'

const STREAM_KEY = 'events:tier2:stream'

// Map<res, { userId: string|null, sessionId: string|null, channels: string[], lastSentId: string|null }>
const _clients = new Map()

// Dedicated Redis connection — XREAD BLOCK holds it, so it must not be shared
// with any other call site (reusing a connection would starve unrelated commands).
let _redis         = null
let _loopRunning   = false
// Liveness: updated on every XREAD return (entries or timeout). Used by
// resourceCounters to detect a silently-dead loop. BLOCK is 30s so this
// ticks at least that often even with zero activity.
let _lastXreadAt   = null
const XREAD_BLOCK_MS = 30_000

function ensureLoop() {
  if (_loopRunning) return
  if (!process.env.REDIS_URL) {
    logger.warn('REDIS_URL not set — SSE broker disabled')
    return
  }
  _loopRunning = true
  _redis = new Redis(process.env.REDIS_URL)
  _redis.on('error', err => logger.error({ err }, 'SSE broker Redis error'))

  // Start from '$' (end of stream) — we only want entries that arrive AFTER
  // the loop starts. Reconnecting clients catch up via the Last-Event-ID
  // replay path on the endpoint, which reads from the stream separately.
  let lastId = '$'

  ;(async () => {
    while (_loopRunning) {
      try {
        const rows = await _redis.xread('BLOCK', XREAD_BLOCK_MS, 'STREAMS', STREAM_KEY, lastId)
        _lastXreadAt = Date.now()
        if (!rows) continue
        // rows = [[ streamKey, [[id, fields], ...] ]]
        const entries = rows[0][1]
        for (const [id, fields] of entries) {
          lastId = id
          dispatchEntry(id, fields)
        }
      } catch (err) {
        logger.error({ err }, 'SSE broker XREAD failed — retrying in 1s')
        await new Promise(r => setTimeout(r, 1000))
      }
    }
  })()
}

function dispatchEntry(id, fields) {
  // fields is a flat array: [key, val, key, val, …].
  const entry = {}
  for (let i = 0; i < fields.length; i += 2) entry[fields[i]] = fields[i + 1]
  const entryUserId = entry.userId ?? '*'
  const channel     = entry.channel ?? ''
  const payload     = entry.payload ?? '{}'

  for (const [res, client] of _clients) {
    // Personal entry: only the target user sees it.
    if (entryUserId !== '*' && entryUserId !== client.userId) continue
    // Channel prefix filter.
    if (client.channels.length > 0) {
      const ok = client.channels.some(prefix => channel.startsWith(prefix))
      if (!ok) continue
    }
    try {
      res.write(`id: ${id}\n`)
      res.write(`event: ${channel}\n`)
      res.write(`data: ${payload}\n\n`)
      client.lastSentId = id
    } catch {
      // Write failed (socket closed but 'close' not fired yet). The 'close'
      // handler on the endpoint will run and unregister us — no-op here.
    }
  }
}

/**
 * Register an SSE client. Caller is responsible for wiring:
 *   res.on('close', () => unregister(res))
 * so dead clients don't accumulate.
 */
export function register(res, { userId = null, sessionId = null, channels = [] } = {}) {
  _clients.set(res, { userId, sessionId, channels, lastSentId: null })
  ensureLoop()
}

/**
 * Look up the response object for a given sseSessionId, if it is currently
 * connected to this process. Used by debug/health endpoints — production
 * dispatch goes through the XREAD loop, not direct lookups.
 */
export function resForSession(sessionId) {
  if (!sessionId) return null
  for (const [res, c] of _clients) {
    if (c.sessionId === sessionId) return res
  }
  return null
}

export function unregister(res) {
  _clients.delete(res)
}

/**
 * Count of currently-registered clients for a given user. Used by the
 * endpoint to enforce a per-user cap.
 */
export function clientCountForUser(userId) {
  if (!userId) return 0
  let n = 0
  for (const [, c] of _clients) if (c.userId === userId) n++
  return n
}

export function totalClients() { return _clients.size }

/**
 * Timestamp of the most recent XREAD return (entry or 30s timeout), or null
 * if the loop hasn't started yet. resourceCounters alerts if this is stale
 * while clients are connected — indicates the broker loop has died silently.
 */
export function getLastXreadAt() { return _lastXreadAt }

/** True once ensureLoop() has booted the XREAD loop. */
export function isLoopRunning() { return _loopRunning }

// Test hook — stops the XREAD loop and drops all clients. Not used in prod.
export function _resetForTests() {
  _loopRunning = false
  _clients.clear()
  _lastXreadAt = null
  try { _redis?.disconnect() } catch {}
  _redis = null
}
