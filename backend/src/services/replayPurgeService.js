// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Replay purge service — nulls out moveStream on expired game records.
 *
 * Game results are retained permanently; only moveStream is deleted.
 * TTL is read from SystemConfig:
 *   replay.casualRetentionDays    (default 90)
 *   replay.tournamentRetentionDays (default 90)
 *
 * Runs once at startup (to catch any backlog), then every 24 hours.
 */
import db from '../lib/db.js'
import logger from '../logger.js'
import { getSystemConfig } from './skillService.js'

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000  // 24 hours

export async function runReplayPurge() {
  try {
    const [casualDays, tournamentDays] = await Promise.all([
      getSystemConfig('replay.casualRetentionDays',    90),
      getSystemConfig('replay.tournamentRetentionDays', 90),
    ])

    const now = new Date()

    const casualCutoff      = new Date(now - casualDays     * 86_400_000)
    const tournamentCutoff  = new Date(now - tournamentDays * 86_400_000)

    const [casualResult, tournamentResult] = await Promise.all([
      db.game.updateMany({
        where: {
          isTournament: false,
          endedAt:      { lt: casualCutoff },
          moveStream:   { not: null },
        },
        data: { moveStream: null },
      }),
      db.game.updateMany({
        where: {
          isTournament: true,
          endedAt:      { lt: tournamentCutoff },
          moveStream:   { not: null },
        },
        data: { moveStream: null },
      }),
    ])

    const total = casualResult.count + tournamentResult.count
    if (total > 0) {
      logger.info(
        { casual: casualResult.count, tournament: tournamentResult.count },
        'replayPurge: purged expired move streams'
      )
    }
    return { casual: casualResult.count, tournament: tournamentResult.count }
  } catch (err) {
    logger.warn({ err }, 'replayPurge: purge run failed (non-fatal)')
    return { casual: 0, tournament: 0 }
  }
}

export function startReplayPurgeJob() {
  // Run once at startup to clear any backlog, then every 24 hours
  runReplayPurge()
  const id = setInterval(runReplayPurge, PURGE_INTERVAL_MS)
  if (id.unref) id.unref()
  logger.info('replayPurge: job started (24h interval)')
  return id
}
