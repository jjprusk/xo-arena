/**
 * Activity tracking service.
 *
 * Tracks when authenticated users were last active and persists it to Postgres.
 * Uses a Redis buffer to avoid a DB write on every socket event or request.
 *
 * Two paths:
 *  - REST:   recordActivity(userId) called from middleware after requireAuth
 *  - Socket: recordActivity(userId) called from socketHandler on any authenticated event
 *
 * A background job flushes buffered timestamps to Postgres every 60s.
 */

import Redis from 'ioredis'
import db from '../lib/db.js'
import { incrementRedis, decrementRedis } from '../lib/resourceCounters.js'
import logger from '../logger.js'

const REDIS_KEY_PREFIX = 'user:active:'
const REDIS_TTL_SECONDS = 300 // 5 min — key auto-expires if flush job dies

let redisClient = null

function getRedis() {
  if (!redisClient && process.env.REDIS_URL) {
    redisClient = new Redis(process.env.REDIS_URL)
    redisClient.on('connect', () => incrementRedis())
    redisClient.on('end',     () => decrementRedis())
    redisClient.on('error', err => logger.warn({ err: err.message }, 'activityService Redis error'))
  }
  return redisClient
}

/**
 * Record activity for a user (domain User.id, not betterAuthId).
 * Writes to Redis; Postgres is updated by the flush job.
 */
export async function recordActivity(userId) {
  if (!userId) return
  const redis = getRedis()
  if (!redis) return // Redis not configured — skip silently
  try {
    await redis.set(`${REDIS_KEY_PREFIX}${userId}`, Date.now(), 'EX', REDIS_TTL_SECONDS)
  } catch (err) {
    logger.warn({ err: err.message }, 'activityService: failed to write to Redis')
  }
}

/**
 * Flush all buffered activity timestamps from Redis to Postgres.
 * Only updates users who currently have an active BaSession — signed-out
 * users are skipped so their lastActiveAt stops updating after sign-out.
 * Called by the background job every 60s.
 */
async function flushActivityToDb() {
  const redis = getRedis()
  if (!redis) return

  try {
    const keys = await redis.keys(`${REDIS_KEY_PREFIX}*`)
    if (keys.length === 0) return

    const values = await redis.mget(...keys)

    const candidates = keys.map((key, i) => {
      const userId = key.slice(REDIS_KEY_PREFIX.length)
      const ts = values[i] ? new Date(Number(values[i])) : null
      return { userId, ts }
    }).filter(u => u.ts)

    if (candidates.length === 0) return

    // Only flush for users who have an active BaSession (i.e. are signed in).
    // Look up betterAuthId for all candidate domain user IDs, then check sessions.
    const domainUsers = await db.user.findMany({
      where: { id: { in: candidates.map(u => u.userId) } },
      select: { id: true, betterAuthId: true },
    })
    const betterAuthIds = domainUsers.map(u => u.betterAuthId).filter(Boolean)

    const activeSessions = await db.baSession.findMany({
      where: { userId: { in: betterAuthIds }, expiresAt: { gt: new Date() } },
      select: { userId: true },
    })
    const activeSet = new Set(activeSessions.map(s => s.userId))

    const updates = candidates.filter(({ userId }) => {
      const du = domainUsers.find(u => u.id === userId)
      return du?.betterAuthId && activeSet.has(du.betterAuthId)
    })

    if (updates.length === 0) return

    await db.$transaction(
      updates.map(({ userId, ts }) =>
        db.user.updateMany({
          where: { id: userId },
          data: { lastActiveAt: ts },
        })
      )
    )

    logger.debug({ count: updates.length }, 'activityService: flushed to Postgres')
  } catch (err) {
    logger.warn({ err: err.message }, 'activityService: flush failed')
  }
}

/**
 * Start the background flush job.
 * Call once at server startup.
 */
export function startActivityFlushJob() {
  const INTERVAL_MS = 60_000
  setInterval(flushActivityToDb, INTERVAL_MS)
  logger.info('activityService: flush job started (60s interval)')
}
