// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 5 — metricsSnapshotService aggregation tests.
 *
 * Covers:
 *  - utcDate normalization
 *  - computeNorthStar happy path + zero-denominator + isTestUser exclusion
 *  - computeFunnelCounts step bucketing + step out-of-range guard
 *  - computeSignupMethodSplit credential/oauth split + 30-day window
 *  - computeTestUserCount excludes bots
 *  - runMetricsSnapshot writes one row per metric and is idempotent
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/db.js', () => ({
  default: {
    user:                  { findMany: vi.fn(), count: vi.fn() },
    tournamentParticipant: { findMany: vi.fn() },
    tournamentMatch:       { findMany: vi.fn() },
    metricsSnapshot:       { create: vi.fn(), deleteMany: vi.fn() },
  },
}))
vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const {
  utcDate,
  computeNorthStar,
  computeFunnelCounts,
  computeSignupMethodSplit,
  computeTestUserCount,
  runMetricsSnapshot,
} = await import('../metricsSnapshotService.js')

const db = (await import('../../lib/db.js')).default

const NOW = new Date('2026-04-25T12:34:56.000Z')
const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  vi.clearAllMocks()
  db.user.findMany.mockResolvedValue([])
  db.user.count.mockResolvedValue(0)
  db.tournamentParticipant.findMany.mockResolvedValue([])
  db.tournamentMatch.findMany.mockResolvedValue([])
  db.metricsSnapshot.create.mockResolvedValue({ id: 'snap_1' })
  db.metricsSnapshot.deleteMany.mockResolvedValue({ count: 0 })
})

// ── utcDate ──────────────────────────────────────────────────────────────────

describe('utcDate', () => {
  it('strips time-of-day to UTC midnight', () => {
    const d = utcDate(new Date('2026-04-25T18:30:00.000Z'))
    expect(d.toISOString()).toBe('2026-04-25T00:00:00.000Z')
  })
})

// ── computeNorthStar ─────────────────────────────────────────────────────────

describe('computeNorthStar', () => {
  it('returns 0/0 when there are no eligible users', async () => {
    db.user.findMany.mockResolvedValueOnce([])     // eligible users
    const r = await computeNorthStar(NOW)
    expect(r).toEqual({ value: 0, denom: 0, numer: 0 })
  })

  it('counts eligible users without bots as 0/N (denom only)', async () => {
    db.user.findMany
      .mockResolvedValueOnce([
        { id: 'u1', createdAt: new Date(NOW.getTime() - 60 * DAY) },
        { id: 'u2', createdAt: new Date(NOW.getTime() - 60 * DAY) },
      ])
      .mockResolvedValueOnce([])    // no bots owned by these users
    const r = await computeNorthStar(NOW)
    expect(r).toEqual({ value: 0, denom: 2, numer: 0 })
  })

  it('credits a user when their bot has a match completed within 30 days of signup', async () => {
    const signup = new Date(NOW.getTime() - 60 * DAY)
    db.user.findMany
      // eligible users
      .mockResolvedValueOnce([{ id: 'u1', createdAt: signup }])
      // bots owned by them
      .mockResolvedValueOnce([{ id: 'b1', botOwnerId: 'u1' }])
    db.tournamentParticipant.findMany.mockResolvedValueOnce([{ id: 'p1', userId: 'b1' }])
    db.tournamentMatch.findMany.mockResolvedValueOnce([
      // completed 5 days after signup → within 30-day window
      { participant1Id: 'p1', participant2Id: null, completedAt: new Date(signup.getTime() + 5 * DAY) },
    ])

    const r = await computeNorthStar(NOW)
    expect(r).toEqual({ value: 1, denom: 1, numer: 1 })
  })

  it('does NOT credit a user whose bot only played AFTER the 30-day window', async () => {
    const signup = new Date(NOW.getTime() - 60 * DAY)
    db.user.findMany
      .mockResolvedValueOnce([{ id: 'u1', createdAt: signup }])
      .mockResolvedValueOnce([{ id: 'b1', botOwnerId: 'u1' }])
    db.tournamentParticipant.findMany.mockResolvedValueOnce([{ id: 'p1', userId: 'b1' }])
    db.tournamentMatch.findMany.mockResolvedValueOnce([
      // 45 days after signup — outside the 30-day window
      { participant1Id: 'p1', participant2Id: null, completedAt: new Date(signup.getTime() + 45 * DAY) },
    ])

    const r = await computeNorthStar(NOW)
    expect(r.value).toBe(0)
  })

  it('isTestUser exclusion: filter is applied at the eligible-user query', async () => {
    db.user.findMany.mockResolvedValueOnce([])
    await computeNorthStar(NOW)
    const args = db.user.findMany.mock.calls[0][0]
    expect(args.where.isTestUser).toBe(false)
    expect(args.where.isBot).toBe(false)
  })
})

// ── computeFunnelCounts ──────────────────────────────────────────────────────

describe('computeFunnelCounts', () => {
  it('returns zeros across step1..step7 when no users exist', async () => {
    const r = await computeFunnelCounts()
    expect(r).toEqual({
      step1: 0, step2: 0, step3: 0, step4: 0, step5: 0, step6: 0, step7: 0,
    })
  })

  it('buckets users into the steps they have completed', async () => {
    db.user.findMany.mockResolvedValueOnce([
      { preferences: { journeyProgress: { completedSteps: [1, 2] } } },
      { preferences: { journeyProgress: { completedSteps: [1, 2, 3, 4] } } },
      { preferences: { journeyProgress: { completedSteps: [1, 2, 3, 4, 5, 6, 7] } } },
      { preferences: {} },
      { preferences: null },
    ])
    const r = await computeFunnelCounts()
    expect(r).toEqual({
      step1: 3, step2: 3, step3: 2, step4: 2, step5: 1, step6: 1, step7: 1,
    })
  })

  it('ignores out-of-range step indices defensively', async () => {
    db.user.findMany.mockResolvedValueOnce([
      { preferences: { journeyProgress: { completedSteps: [1, 99, -3, 'oops'] } } },
    ])
    const r = await computeFunnelCounts()
    expect(r.step1).toBe(1)
    expect(Object.values(r).reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('filters isTestUser=false at the query', async () => {
    await computeFunnelCounts()
    const args = db.user.findMany.mock.calls[0][0]
    expect(args.where.isTestUser).toBe(false)
    expect(args.where.isBot).toBe(false)
  })
})

// ── computeSignupMethodSplit ─────────────────────────────────────────────────

describe('computeSignupMethodSplit', () => {
  it('splits by oauthProvider (email + null = credential, else oauth)', async () => {
    db.user.findMany.mockResolvedValueOnce([
      { oauthProvider: 'email' },
      { oauthProvider: 'email' },
      { oauthProvider: 'google' },
      { oauthProvider: 'apple' },
      { oauthProvider: null },
    ])
    const r = await computeSignupMethodSplit(NOW)
    expect(r).toEqual({ credential: 3, oauth: 2 })
  })

  it('uses a 30-day lookback window with isTestUser=false filter', async () => {
    await computeSignupMethodSplit(NOW)
    const args = db.user.findMany.mock.calls[0][0]
    expect(args.where.isTestUser).toBe(false)
    expect(args.where.isBot).toBe(false)
    const since = args.where.createdAt.gte
    const expected = new Date(NOW.getTime() - 30 * DAY)
    expect(since.getTime()).toBe(expected.getTime())
  })
})

// ── computeTestUserCount ─────────────────────────────────────────────────────

describe('computeTestUserCount', () => {
  it('counts isTestUser=true non-bot users only', async () => {
    db.user.count.mockResolvedValueOnce(7)
    const r = await computeTestUserCount()
    expect(r).toBe(7)
    const args = db.user.count.mock.calls[0][0]
    expect(args.where).toEqual({ isTestUser: true, isBot: false })
  })
})

// ── runMetricsSnapshot ───────────────────────────────────────────────────────

describe('runMetricsSnapshot', () => {
  it('writes one row per metric for a given UTC date', async () => {
    db.user.count.mockResolvedValue(2)
    await runMetricsSnapshot(NOW)

    // 1 northStar + 7 funnel + 2 signup + 1 testUserCount = 11 writes
    expect(db.metricsSnapshot.create).toHaveBeenCalledTimes(11)
    // Date is normalized to UTC midnight on every row
    for (const call of db.metricsSnapshot.create.mock.calls) {
      expect(call[0].data.date.toISOString()).toBe('2026-04-25T00:00:00.000Z')
    }
  })

  it('is idempotent — re-runs delete-then-create the same rows', async () => {
    await runMetricsSnapshot(NOW)
    await runMetricsSnapshot(NOW)
    // 11 writes per run × 2 runs = 22 creates; same number of upfront deletes
    expect(db.metricsSnapshot.create).toHaveBeenCalledTimes(22)
    expect(db.metricsSnapshot.deleteMany).toHaveBeenCalledTimes(22)
  })

  it('returns null and does not throw when an underlying query fails', async () => {
    db.user.findMany.mockRejectedValueOnce(new Error('DB offline'))
    const r = await runMetricsSnapshot(NOW)
    expect(r).toBeNull()
  })
})
