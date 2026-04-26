// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * MetricsSnapshot service — Sprint 5 (Intelligent_Guide_Requirements.md §2 / §10.4).
 *
 * Daily UTC-midnight aggregator. Computes the v1 metric set and writes it to
 * the `metricsSnapshot` table. The unique `(date, metric, dimensions)` index
 * makes re-running the cron for the same date idempotent — every call upserts
 * the same row.
 *
 * v1 metric set:
 *
 *   northStar          — % of registered users (signed up ≥30 days ago) whose
 *                        bot played at least one tournament match within
 *                        30 days of signup. Float in [0, 1].
 *
 *   funnelStep1..step7 — count of users with that step in completedSteps.
 *                        Drop-off per step = funnelStepN - funnelStep(N+1).
 *
 *   signupCredential   — count of users created in the last 30 days whose
 *                        oauthProvider == "email".
 *   signupOauth        — count of users created in the last 30 days whose
 *                        oauthProvider != "email".
 *
 *   testUserCount      — count of users currently flagged isTestUser=true.
 *                        Inverts the standard filter; powers the dashboard
 *                        "excluding N test users" footer.
 *
 * All real-user metrics filter `WHERE user.isTestUser = false AND isBot = false`
 * per §2 (uniform metrics filter).
 *
 * Time-to-signup median + landing-conversion funnel both require pre-signup
 * visitor tracking that doesn't exist in v1; deferred to Sprint 6 / v1.1
 * once the Phase 0 instrumentation lands.
 */

import db from '../lib/db.js'
import logger from '../logger.js'

const MS_PER_DAY      = 24 * 60 * 60 * 1000
const NORTH_STAR_DAYS = 30   // days from signup → must compete
const SIGNUP_LOOKBACK = 30   // days for signup-method split
const TOTAL_STEPS     = 7

/** Returns the UTC date (00:00:00.000Z) for a given Date. */
export function utcDate(d = new Date()) {
  const t = new Date(d)
  t.setUTCHours(0, 0, 0, 0)
  return t
}

/**
 * North Star — % of users (signed up ≥30 days ago, real, non-bot, non-test)
 * whose bot played at least one tournament match within 30 days of signup.
 *
 * Returns { value: Float in [0,1], denom: Int, numer: Int } so the dashboard
 * can also render "X / Y" beside the percentage.
 */
export async function computeNorthStar(now = new Date()) {
  const cutoff = new Date(now.getTime() - NORTH_STAR_DAYS * MS_PER_DAY)
  const eligible = await db.user.findMany({
    where: {
      isBot:      false,
      isTestUser: false,
      createdAt:  { lte: cutoff },
    },
    select: { id: true, createdAt: true },
  })
  if (eligible.length === 0) return { value: 0, denom: 0, numer: 0 }

  const ownerIds = eligible.map(u => u.id)

  // 1. all bots owned by these users
  const bots = await db.user.findMany({
    where:  { isBot: true, botOwnerId: { in: ownerIds } },
    select: { id: true, botOwnerId: true },
  })
  const botToOwner = new Map(bots.map(b => [b.id, b.botOwnerId]))
  if (bots.length === 0) return { value: 0, denom: eligible.length, numer: 0 }

  const botIds = bots.map(b => b.id)

  // 2. all participations for these bots
  const participations = await db.tournamentParticipant.findMany({
    where:  { userId: { in: botIds } },
    select: { id: true, userId: true },
  })
  if (participations.length === 0) return { value: 0, denom: eligible.length, numer: 0 }

  const partToBot = new Map(participations.map(p => [p.id, p.userId]))
  const partIds   = participations.map(p => p.id)

  // 3. all completed matches for these participants
  const matches = await db.tournamentMatch.findMany({
    where: {
      completedAt: { not: null },
      OR: [
        { participant1Id: { in: partIds } },
        { participant2Id: { in: partIds } },
      ],
    },
    select: { participant1Id: true, participant2Id: true, completedAt: true },
  })

  // 4. Bucket matches by owner; check whether any match's completedAt fell
  // within 30 days of that owner's signup.
  const ownerSignupAt = new Map(eligible.map(u => [u.id, u.createdAt.getTime()]))
  const qualifiedOwners = new Set()
  for (const m of matches) {
    const partId = m.participant1Id && partIds.includes(m.participant1Id)
      ? m.participant1Id
      : m.participant2Id
    if (!partId) continue
    const botId = partToBot.get(partId)
    const ownerId = botToOwner.get(botId)
    if (!ownerId) continue
    if (qualifiedOwners.has(ownerId)) continue
    const signedAt = ownerSignupAt.get(ownerId)
    if (signedAt == null) continue
    const ageMs = m.completedAt.getTime() - signedAt
    if (ageMs >= 0 && ageMs <= NORTH_STAR_DAYS * MS_PER_DAY) {
      qualifiedOwners.add(ownerId)
    }
  }

  return {
    value: qualifiedOwners.size / eligible.length,
    denom: eligible.length,
    numer: qualifiedOwners.size,
  }
}

/**
 * Funnel — count of real users at each of the 7 journey steps.
 *
 * Returns an object { step1: N, step2: N, ..., step7: N } where stepK is the
 * count of users who have step K in their journeyProgress.completedSteps.
 *
 * v1 implementation: read users + their preferences in one pass and count in
 * memory. The user table is small enough that this is fine; if it grows past
 * ~50k real users, switch to a raw SQL aggregate over the JSON column.
 */
export async function computeFunnelCounts() {
  const users = await db.user.findMany({
    where:  { isBot: false, isTestUser: false },
    select: { preferences: true },
  })
  const counts = Object.fromEntries(
    Array.from({ length: TOTAL_STEPS }, (_, i) => [`step${i + 1}`, 0])
  )
  for (const u of users) {
    const completed = u?.preferences?.journeyProgress?.completedSteps
    if (!Array.isArray(completed)) continue
    for (const step of completed) {
      const key = `step${step}`
      if (key in counts) counts[key]++
    }
  }
  return counts
}

/**
 * Signup-method split for the last 30 days. Returns { credential, oauth }.
 * Filters on isTestUser=false to match the rest of the metric set.
 *
 * The kickoff also wanted "build-bot CTA vs plain Sign in" but that's not a
 * field that exists yet — the closest signal is auth method.
 */
export async function computeSignupMethodSplit(now = new Date()) {
  const since = new Date(now.getTime() - SIGNUP_LOOKBACK * MS_PER_DAY)
  const recent = await db.user.findMany({
    where: {
      isBot:      false,
      isTestUser: false,
      createdAt:  { gte: since },
    },
    select: { oauthProvider: true },
  })
  let credential = 0
  let oauth      = 0
  for (const u of recent) {
    if (u.oauthProvider === 'email' || u.oauthProvider == null) credential++
    else oauth++
  }
  return { credential, oauth }
}

/**
 * Count of users currently flagged isTestUser=true (excluded from real-user
 * metrics). Drives the "excluding N test users" dashboard footer.
 */
export async function computeTestUserCount() {
  return db.user.count({ where: { isTestUser: true, isBot: false } })
}

// ── Snapshot writer ─────────────────────────────────────────────────────────

async function _upsert(date, metric, value, dimensions = {}) {
  // The schema's @@unique on (date, metric, dimensions) makes this safe to
  // re-run for the same date — same key means same row, never a duplicate.
  // Prisma can't compose a compound where on a JSON column directly via the
  // unique-constraint helper, so we use deleteMany + create. Cheap because
  // the row count per (date) is small.
  await db.metricsSnapshot.deleteMany({ where: { date, metric, dimensions } })
  await db.metricsSnapshot.create({ data: { date, metric, value, dimensions } })
}

/**
 * Compute and persist the full v1 metric set for the given date. Idempotent —
 * safe to re-run for the same date (overwrites that day's row).
 *
 * Returns the computed { northStar, funnel, signup, testUserCount } so callers
 * (cron + admin endpoint) can log + return it without re-querying.
 */
export async function runMetricsSnapshot(now = new Date()) {
  const date = utcDate(now)
  try {
    const [northStar, funnel, signup, testUserCount] = await Promise.all([
      computeNorthStar(now),
      computeFunnelCounts(),
      computeSignupMethodSplit(now),
      computeTestUserCount(),
    ])

    await Promise.all([
      _upsert(date, 'northStar', northStar.value, { denom: northStar.denom, numer: northStar.numer }),
      ...Object.entries(funnel).map(([step, count]) =>
        _upsert(date, 'funnel', count, { step })
      ),
      _upsert(date, 'signup', signup.credential, { method: 'credential' }),
      _upsert(date, 'signup', signup.oauth,      { method: 'oauth' }),
      _upsert(date, 'testUserCount', testUserCount, {}),
    ])

    logger.info({ date, northStar, funnel, signup, testUserCount }, 'metricsSnapshot: written')
    return { date, northStar, funnel, signup, testUserCount }
  } catch (err) {
    logger.warn({ err }, 'metricsSnapshot: aggregation failed (non-fatal)')
    return null
  }
}

// ── Cron ────────────────────────────────────────────────────────────────────

const HOURLY_MS = 60 * 60 * 1000

let _started = false

/**
 * Starts the hourly snapshot interval. Idempotent + safe to call from
 * server startup. Each tick computes for "today UTC" — the unique index
 * makes re-runs safe.
 *
 * The admin /admin/guide-metrics endpoint can also call runMetricsSnapshot()
 * directly to refresh on demand.
 */
export function startMetricsSnapshotCron() {
  if (_started) return
  _started = true
  // Run once at startup to backfill today if missing.
  runMetricsSnapshot().catch(() => {})
  const id = setInterval(() => { runMetricsSnapshot().catch(() => {}) }, HOURLY_MS)
  if (id.unref) id.unref()
  logger.info({ intervalMs: HOURLY_MS }, 'metricsSnapshot: cron started (hourly idempotent)')
  return id
}
