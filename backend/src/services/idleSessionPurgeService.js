// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Idle session purge service.
 *
 * Deletes BetterAuth sessions for users whose lastActiveAt has exceeded
 * idleWarnMinutes + idleGraceMinutes (the same threshold the frontend
 * IdleLogoutManager uses). This catches browsers that were closed without
 * signing out — the frontend timer never fires in those cases.
 *
 * Runs every 5 minutes. Config is read fresh each run so admin changes
 * take effect without a restart.
 */
import db from '../lib/db.js'
import logger from '../logger.js'
import { getSystemConfig } from './skillService.js'

const PURGE_INTERVAL_MS = 5 * 60_000  // 5 minutes

async function runIdleSessionPurge() {
  try {
    const [warnMinutes, graceMinutes] = await Promise.all([
      getSystemConfig('session.idleWarnMinutes',  30),
      getSystemConfig('session.idleGraceMinutes',  5),
    ])

    const thresholdMs  = (warnMinutes + graceMinutes) * 60_000
    const cutoff       = new Date(Date.now() - thresholdMs)

    // Find domain users whose lastActiveAt is older than the threshold.
    // Users with null lastActiveAt have never been active — skip them
    // (they just signed up and haven't done anything yet).
    const staleUsers = await db.user.findMany({
      where: {
        lastActiveAt: { not: null, lt: cutoff },
        betterAuthId: { not: null },
      },
      select: { id: true, username: true, betterAuthId: true },
    })

    if (staleUsers.length === 0) return

    const betterAuthIds = staleUsers.map(u => u.betterAuthId)

    // Only delete sessions that are actually still alive (expiresAt in future).
    const { count } = await db.baSession.deleteMany({
      where: {
        userId:    { in: betterAuthIds },
        expiresAt: { gt: new Date() },
      },
    })

    if (count > 0) {
      logger.info(
        { count, users: staleUsers.map(u => u.username) },
        'idleSessionPurge: expired idle sessions'
      )
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'idleSessionPurge: run failed')
  }
}

export function startIdleSessionPurgeJob() {
  // Run once at startup to catch any backlog, then on the interval.
  runIdleSessionPurge()
  setInterval(runIdleSessionPurge, PURGE_INTERVAL_MS)
  logger.info('idleSessionPurge: job started (5 min interval)')
}
