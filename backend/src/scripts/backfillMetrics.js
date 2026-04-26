// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 6 — historical metrics backfill.
 *
 * Walks each past UTC day from the earliest user signup (or `--days N`)
 * up to today and writes MetricsSnapshot rows for the metrics that are
 * *derivable from durable raw events*:
 *
 *   - northStar  — users.createdAt + tournament_matches.completedAt are
 *                   both immutable, so "as of past day X" can be computed
 *                   accurately by passing X as `now` to computeNorthStar.
 *   - signup     — users.createdAt + users.oauthProvider are immutable.
 *
 * NOT backfilled (these would write a misleading flat trend because the
 * underlying state is point-in-time current, not historical):
 *
 *   - funnel        — journeyProgress.completedSteps has no per-step
 *                      timestamp; we'd write today's funnel as every past
 *                      day's funnel.
 *   - testUserCount — same: current isTestUser only, no history.
 *
 * The hourly cron starts writing accurate funnel + testUserCount rows
 * from the first deploy day forward; the dashboard's funnel trend will
 * be empty before that day. That's correct, not a bug.
 *
 * Idempotent: the snapshot writer deletes-then-creates per
 * (date, metric, dimensions), so re-running for the same range upserts
 * cleanly with no duplicates.
 *
 * Usage (from backend/):
 *   docker compose exec backend node src/scripts/backfillMetrics.js [options]
 *
 * Options:
 *   --days=N      lookback in days from today (default: walk from earliest user)
 *   --dry-run     compute but do not write
 *   --verbose     print per-day output (default: every 7th day + summary)
 */

import 'dotenv/config'
import db     from '../lib/db.js'
import logger from '../logger.js'
import {
  computeNorthStar,
  computeSignupMethodSplit,
  utcDate,
} from '../services/metricsSnapshotService.js'

const ARGS = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=')
      return [k, v ?? 'true']
    })
)

const dryRun  = !!ARGS['dry-run']
const verbose = !!ARGS.verbose
const daysArg = ARGS.days ? Number(ARGS.days) : null

const MS_PER_DAY = 24 * 60 * 60 * 1000

async function _findStartDate() {
  if (Number.isFinite(daysArg) && daysArg > 0) {
    return utcDate(new Date(Date.now() - daysArg * MS_PER_DAY))
  }
  const earliest = await db.user.findFirst({
    where:   { isBot: false },
    orderBy: { createdAt: 'asc' },
    select:  { createdAt: true },
  })
  if (!earliest) return utcDate(new Date())
  return utcDate(earliest.createdAt)
}

async function _writeRow(date, metric, value, dimensions = {}) {
  if (dryRun) return
  await db.metricsSnapshot.deleteMany({ where: { date, metric, dimensions } })
  await db.metricsSnapshot.create({ data: { date, metric, value, dimensions } })
}

async function _backfillDay(asOf) {
  const date = utcDate(asOf)
  const [northStar, signup] = await Promise.all([
    computeNorthStar(asOf),
    computeSignupMethodSplit(asOf),
  ])
  await Promise.all([
    _writeRow(date, 'northStar', northStar.value, { denom: northStar.denom, numer: northStar.numer }),
    _writeRow(date, 'signup',    signup.credential, { method: 'credential' }),
    _writeRow(date, 'signup',    signup.oauth,      { method: 'oauth' }),
  ])
  return { date, northStar, signup }
}

async function main() {
  const start = await _findStartDate()
  const end   = utcDate(new Date())
  const total = Math.max(1, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1)

  logger.info({ start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), total, dryRun }, 'backfillMetrics: starting')

  let written = 0
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += MS_PER_DAY) {
    // Pin "asOf" at end-of-day UTC so the day's full window of activity is
    // included. utcDate normalises back to 00:00 for the row's `date` column.
    const asOf = new Date(cursor + (MS_PER_DAY - 1))
    const r = await _backfillDay(asOf)
    written++
    if (verbose || (written % 7 === 0)) {
      logger.info({
        date:  r.date.toISOString().slice(0, 10),
        northStar: r.northStar.value.toFixed(3),
        denom:     r.northStar.denom,
        signup:    `${r.signup.credential}/${r.signup.oauth}`,
      }, `backfillMetrics: day ${written}/${total}`)
    }
  }

  logger.info({ daysWritten: written, dryRun }, 'backfillMetrics: complete')
  await db.$disconnect()
  process.exit(0)
}

main().catch(async err => {
  logger.error({ err }, 'backfillMetrics: failed')
  await db.$disconnect().catch(() => {})
  process.exit(1)
})
