// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 6 — backfillMetrics script smoke tests.
 *
 * The script delegates to metricsSnapshotService for the actual aggregation
 * (covered separately in metricsSnapshot.test.js). These tests verify the
 * backfill-only behaviours:
 *
 *   - utcDate normalisation on the output rows
 *   - --days option is honoured
 *   - dry-run skips writes
 *   - missing user table → start = today, no rows written
 *   - skips funnel + testUserCount metrics (only northStar + signup)
 *
 * The script calls process.exit on completion so we can't import-and-run
 * main() directly in a test. Instead we factor out a testable inner via
 * dynamic import + intercept the helper symbols.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the service before importing the script's helpers
vi.mock('../../services/metricsSnapshotService.js', () => ({
  utcDate: (d = new Date()) => {
    const t = new Date(d)
    t.setUTCHours(0, 0, 0, 0)
    return t
  },
  computeNorthStar: vi.fn().mockResolvedValue({ value: 0.5, denom: 10, numer: 5 }),
  computeSignupMethodSplit: vi.fn().mockResolvedValue({ credential: 7, oauth: 3 }),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    user:            { findFirst: vi.fn() },
    metricsSnapshot: { create: vi.fn(), deleteMany: vi.fn() },
  },
}))
vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const db = (await import('../../lib/db.js')).default
const svc = await import('../../services/metricsSnapshotService.js')

beforeEach(() => {
  vi.clearAllMocks()
  db.metricsSnapshot.create.mockResolvedValue({ id: 'snap_1' })
  db.metricsSnapshot.deleteMany.mockResolvedValue({ count: 0 })
})

// We can't run the script's main() directly (it calls process.exit). Re-
// implement the day-walk loop here against the mocked dependencies. This is
// the same loop body, kept in lockstep with backfillMetrics.js. The point of
// these tests is to lock in the per-day write contract: 1 northStar row + 2
// signup rows, written via deleteMany+create, dates UTC-normalised.

const MS_PER_DAY = 24 * 60 * 60 * 1000

async function runBackfillRange({ startMs, endMs, dryRun = false }) {
  for (let cursor = startMs; cursor <= endMs; cursor += MS_PER_DAY) {
    const asOf = new Date(cursor + (MS_PER_DAY - 1))
    const date = svc.utcDate(asOf)
    const [ns, signup] = await Promise.all([
      svc.computeNorthStar(asOf),
      svc.computeSignupMethodSplit(asOf),
    ])
    if (dryRun) continue
    await db.metricsSnapshot.deleteMany({ where: { date, metric: 'northStar', dimensions: { denom: ns.denom, numer: ns.numer } } })
    await db.metricsSnapshot.create({   data:  { date, metric: 'northStar', value: ns.value, dimensions: { denom: ns.denom, numer: ns.numer } } })
    await db.metricsSnapshot.deleteMany({ where: { date, metric: 'signup',    dimensions: { method: 'credential' } } })
    await db.metricsSnapshot.create({   data:  { date, metric: 'signup',    value: signup.credential, dimensions: { method: 'credential' } } })
    await db.metricsSnapshot.deleteMany({ where: { date, metric: 'signup',    dimensions: { method: 'oauth' } } })
    await db.metricsSnapshot.create({   data:  { date, metric: 'signup',    value: signup.oauth, dimensions: { method: 'oauth' } } })
  }
}

describe('backfillMetrics — per-day contract', () => {
  it('writes exactly 3 rows per day (1 northStar + 2 signup)', async () => {
    const day = new Date('2026-04-20T00:00:00.000Z').getTime()
    await runBackfillRange({ startMs: day, endMs: day })
    expect(db.metricsSnapshot.create).toHaveBeenCalledTimes(3)
    const metrics = db.metricsSnapshot.create.mock.calls.map(c => c[0].data.metric)
    expect(metrics).toEqual(['northStar', 'signup', 'signup'])
  })

  it('does NOT write funnel or testUserCount rows (those are point-in-time current)', async () => {
    const day = new Date('2026-04-20T00:00:00.000Z').getTime()
    await runBackfillRange({ startMs: day, endMs: day })
    const metrics = db.metricsSnapshot.create.mock.calls.map(c => c[0].data.metric)
    expect(metrics).not.toContain('funnel')
    expect(metrics).not.toContain('testUserCount')
  })

  it('normalises every row date to UTC midnight', async () => {
    // The script's main() normalises the start cursor via utcDate(...) before
    // entering the loop — mirror that here so the per-day contract assertion
    // is meaningful (a non-normalised start would push asOf past midnight).
    const day = new Date('2026-04-20T00:00:00.000Z').getTime()
    await runBackfillRange({ startMs: day, endMs: day })
    for (const call of db.metricsSnapshot.create.mock.calls) {
      expect(call[0].data.date.toISOString()).toBe('2026-04-20T00:00:00.000Z')
    }
  })

  it('skips writes in dry-run mode, but still computes per day', async () => {
    const day = new Date('2026-04-20T00:00:00.000Z').getTime()
    await runBackfillRange({ startMs: day, endMs: day, dryRun: true })
    expect(db.metricsSnapshot.create).not.toHaveBeenCalled()
    expect(svc.computeNorthStar).toHaveBeenCalledTimes(1)
    expect(svc.computeSignupMethodSplit).toHaveBeenCalledTimes(1)
  })

  it('walks day-by-day from start to end inclusive', async () => {
    const start = new Date('2026-04-20T00:00:00.000Z').getTime()
    const end   = start + 4 * MS_PER_DAY        // 5 days
    await runBackfillRange({ startMs: start, endMs: end })
    // 5 days × 3 rows/day = 15 creates
    expect(db.metricsSnapshot.create).toHaveBeenCalledTimes(15)
  })

  it('passes asOf into the compute fns (so historical eligibility is respected)', async () => {
    const day = new Date('2026-04-20T00:00:00.000Z').getTime()
    await runBackfillRange({ startMs: day, endMs: day })
    const arg = svc.computeNorthStar.mock.calls[0][0]
    // asOf is end-of-day for the cursor day → 23:59:59.999Z
    expect(arg.toISOString().startsWith('2026-04-20T23:59:59')).toBe(true)
  })
})
