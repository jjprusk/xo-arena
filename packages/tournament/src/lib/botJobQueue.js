/**
 * Redis-backed job queue for BOT_VS_BOT tournament matches.
 *
 * Keys:
 *   tournament:bot:pending — Redis List  (RPUSH to enqueue, LPOP to dequeue)
 *   tournament:bot:active  — Redis Hash  (matchId → JSON job) for in-flight tracking
 *
 * Job shape: { matchId, tournamentId, enqueuedAt }
 *
 * All functions are no-ops (returning safe defaults) when Redis is unavailable.
 */

import db from '@xo-arena/db'
import logger from '../logger.js'
import { getRedis } from './redis.js'

const PENDING_KEY = 'tournament:bot:pending'
const ACTIVE_KEY  = 'tournament:bot:active'

/**
 * Enqueue a job for a BOT_VS_BOT match.
 * RPUSH to the pending list.
 */
export async function enqueueJob(matchId, tournamentId) {
  const redis = getRedis()
  if (!redis) return

  const job = { matchId, tournamentId, enqueuedAt: new Date().toISOString() }
  try {
    await redis.rpush(PENDING_KEY, JSON.stringify(job))
    logger.debug({ matchId, tournamentId }, 'Bot job enqueued')
  } catch (err) {
    logger.error({ err, matchId }, 'Failed to enqueue bot job')
  }
}

/**
 * Dequeue the next job from the pending list (LPOP).
 * After dequeue, mark it active in the hash.
 * Returns parsed job object or null.
 */
export async function dequeueJob() {
  const redis = getRedis()
  if (!redis) return null

  try {
    const raw = await redis.lpop(PENDING_KEY)
    if (!raw) return null

    const job = JSON.parse(raw)
    // Mark as active
    await redis.hset(ACTIVE_KEY, job.matchId, JSON.stringify(job))
    return job
  } catch (err) {
    logger.error({ err }, 'Failed to dequeue bot job')
    return null
  }
}

/**
 * Acknowledge (remove) a completed job from the active hash.
 */
export async function acknowledgeJob(matchId) {
  const redis = getRedis()
  if (!redis) return

  try {
    await redis.hdel(ACTIVE_KEY, matchId)
    logger.debug({ matchId }, 'Bot job acknowledged')
  } catch (err) {
    logger.error({ err, matchId }, 'Failed to acknowledge bot job')
  }
}

/**
 * Returns the number of currently active (in-flight) jobs.
 */
export async function getActiveCount() {
  const redis = getRedis()
  if (!redis) return 0

  try {
    return await redis.hlen(ACTIVE_KEY)
  } catch (err) {
    logger.error({ err }, 'Failed to get active job count')
    return 0
  }
}

/**
 * Returns the number of jobs waiting in the pending queue.
 */
export async function getQueueDepth() {
  const redis = getRedis()
  if (!redis) return 0

  try {
    return await redis.llen(PENDING_KEY)
  } catch (err) {
    logger.error({ err }, 'Failed to get queue depth')
    return 0
  }
}

/**
 * Returns all currently active jobs as an array of parsed job objects.
 */
export async function getActiveJobs() {
  const redis = getRedis()
  if (!redis) return []

  try {
    const hash = await redis.hgetall(ACTIVE_KEY)
    if (!hash) return []
    return Object.values(hash).map(raw => JSON.parse(raw))
  } catch (err) {
    logger.error({ err }, 'Failed to get active jobs')
    return []
  }
}

/**
 * On startup: reconcile orphaned in-progress matches.
 *
 * Finds all TournamentMatch rows with status='IN_PROGRESS' in BOT_VS_BOT
 * tournaments, resets them to 'PENDING', and re-enqueues them.
 * Also clears the stale Redis active set.
 */
export async function reconcileOrphans() {
  // Clear stale active set from previous run
  const redis = getRedis()
  if (redis) {
    try {
      await redis.del(ACTIVE_KEY)
      logger.info('Bot worker: cleared stale active set')
    } catch (err) {
      logger.error({ err }, 'Bot worker: failed to clear active set')
    }
  }

  // Find all IN_PROGRESS matches in BOT_VS_BOT tournaments
  let orphans
  try {
    orphans = await db.tournamentMatch.findMany({
      where: {
        status: 'IN_PROGRESS',
        round: {
          tournament: {
            mode: 'BOT_VS_BOT',
          },
        },
      },
      include: {
        round: {
          select: {
            tournamentId: true,
          },
        },
      },
    })
  } catch (err) {
    logger.error({ err }, 'Bot worker: failed to query orphaned matches')
    return
  }

  if (orphans.length === 0) {
    logger.info('Bot worker: no orphaned matches found')
    return
  }

  logger.info({ count: orphans.length }, 'Bot worker: reconciling orphaned matches')

  for (const match of orphans) {
    try {
      // Reset to PENDING
      await db.tournamentMatch.update({
        where: { id: match.id },
        data: { status: 'PENDING' },
      })
      // Re-enqueue
      await enqueueJob(match.id, match.round.tournamentId)
      logger.info({ matchId: match.id }, 'Bot worker: orphaned match re-queued')
    } catch (err) {
      logger.error({ err, matchId: match.id }, 'Bot worker: failed to reconcile orphaned match')
    }
  }
}
