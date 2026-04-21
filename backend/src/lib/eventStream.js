// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tier 2 event replay stream (backend side).
 *
 * The tournament service writes tournament-scoped broadcasts to the same
 * Redis stream (see `tournament/src/lib/redis.js`). The backend writes
 * notifications and presence broadcasts here. The `/api/v1/events/replay`
 * endpoint reads from the combined stream and filters per-user.
 *
 * Stream schema (fields on each XADD entry):
 *   channel: string      — e.g. 'guide:notification', 'table:presence'
 *   payload: JSON string — event-specific body
 *   userId:  string      — target user id; '*' means broadcast
 *
 * The Redis-assigned stream id (`<ms>-<seq>`) is treated as an opaque
 * monotonic cursor by clients (compatible with SSE Last-Event-ID).
 */
import Redis from 'ioredis'
import logger from '../logger.js'

const STREAM_KEY     = 'events:tier2:stream'
const STREAM_MAX_LEN = 5000

let _redis = null
function getRedis() {
  if (!_redis) {
    if (!process.env.REDIS_URL) return null
    _redis = new Redis(process.env.REDIS_URL)
    _redis.on('error', err => logger.error({ err }, 'eventStream Redis error'))
  }
  return _redis
}

/**
 * Append a Tier 2 event to the replay stream.
 * Does NOT emit to live subscribers — callers emit via socket.io as today.
 * Silently no-ops if Redis is unavailable.
 *
 * @param {string}  channel     - e.g. 'guide:notification'
 * @param {object}  payload     - event body
 * @param {object}  [opts]
 * @param {string|null} [opts.userId] - target user id, or null/undefined for broadcast
 * @returns {Promise<string|null>} - the Redis stream id, or null if Redis unavailable
 */
export async function appendToStream(channel, payload, { userId = null } = {}) {
  const redis = getRedis()
  if (!redis) return null
  try {
    return await redis.xadd(
      STREAM_KEY,
      'MAXLEN', '~', String(STREAM_MAX_LEN),
      '*',
      'channel', channel,
      'payload', JSON.stringify(payload ?? {}),
      'userId',  userId || '*',
    )
  } catch (err) {
    logger.error({ err, channel }, 'Redis XADD (events stream) failed')
    return null
  }
}

/**
 * Read entries from the stream after a given id.
 * Used by GET /api/v1/events/replay.
 *
 * @param {string|null} sinceId - Redis stream id; null/undefined → latest N entries
 * @param {object}      [opts]
 * @param {number}      [opts.limit=200]   - max entries to return
 * @param {string|null} [opts.userId=null] - filter: return entries where userId === '*' or matches
 * @returns {Promise<{ events: Array<{id, channel, payload, userId}>, latestId: string|null }>}
 */
export async function readStream(sinceId, { limit = 200, userId = null } = {}) {
  const redis = getRedis()
  if (!redis) return { events: [], latestId: null }

  let rows
  try {
    if (sinceId) {
      // XRANGE with '(' prefix means exclusive — strictly AFTER sinceId.
      rows = await redis.xrange(STREAM_KEY, `(${sinceId}`, '+', 'COUNT', limit)
    } else {
      // No cursor — give the newest `limit` entries in chronological order.
      const rev = await redis.xrevrange(STREAM_KEY, '+', '-', 'COUNT', limit)
      rows = rev.reverse()
    }
  } catch (err) {
    logger.error({ err, sinceId }, 'Redis XRANGE (events stream) failed')
    return { events: [], latestId: null }
  }

  const events = []
  for (const [id, fields] of rows) {
    const obj = {}
    for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1]
    const entryUserId = obj.userId ?? '*'
    // Filter: broadcast entries always pass; personal entries only pass for their owner.
    if (entryUserId !== '*' && userId && entryUserId !== userId) continue
    if (entryUserId !== '*' && !userId) continue  // anonymous caller never sees personal events
    let payload = {}
    try { payload = obj.payload ? JSON.parse(obj.payload) : {} } catch {}
    events.push({ id, channel: obj.channel ?? '', payload, userId: entryUserId })
  }
  return { events, latestId: events.length ? events[events.length - 1].id : sinceId ?? null }
}
