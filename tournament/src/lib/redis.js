// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Redis pubsub + Tier 2 event stream.
 *
 * Two delivery mechanisms, both driven by `publish()`:
 *
 *   1. Redis PUBLISH (original) — fan-out to live subscribers
 *      (backend `tournamentBridge.js` consumes this, forwards to sockets).
 *
 *   2. Redis Stream XADD — persistent ring buffer for Tier 2 event replay.
 *      Consumed by `GET /api/v1/events/replay` so SSE clients reconnecting
 *      with `Last-Event-ID` can catch up on missed events. Ring is auto-trimmed
 *      to ~5000 entries (MAXLEN ~) so memory stays bounded regardless of
 *      publish volume.
 *
 * Design notes:
 *   - Single combined stream across all Tier 2 channels. Clients filter by
 *     `channel` field. Makes Last-Event-ID a single monotonic cursor.
 *   - Stream ID format is Redis-native `<ms>-<seq>`. Treated as an opaque
 *     string by clients; ordering is guaranteed.
 *   - XADD failures are logged but non-fatal — the PUBLISH side still
 *     delivers to live subscribers. Replay just misses this event.
 *   - The stream key (`events:tier2:stream`) is shared with the backend
 *     service, which reads the same stream for the /events/replay endpoint.
 */
import Redis from 'ioredis'
import logger from '../logger.js'

const STREAM_KEY     = 'events:tier2:stream'
const STREAM_MAX_LEN = 5000

let _redis = null

function getRedis() {
  if (!_redis) {
    if (!process.env.REDIS_URL) {
      logger.warn('REDIS_URL not set — Redis publish disabled')
      return null
    }
    _redis = new Redis(process.env.REDIS_URL)
    _redis.on('error', err => logger.error({ err }, 'Redis error'))
  }
  return _redis
}

export async function publish(channel, payload) {
  const redis = getRedis()
  if (!redis) return
  const body = JSON.stringify(payload)
  try {
    await redis.publish(channel, body)
  } catch (err) {
    logger.error({ err, channel }, 'Redis publish failed')
  }
  // Write to the Tier 2 replay stream. Separate try/catch so a stream failure
  // doesn't silently break the pubsub path (or vice versa).
  try {
    await redis.xadd(
      STREAM_KEY,
      'MAXLEN', '~', String(STREAM_MAX_LEN),
      '*',
      'channel', channel,
      'payload', body,
    )
  } catch (err) {
    logger.error({ err, channel }, 'Redis XADD (events stream) failed')
  }
}
