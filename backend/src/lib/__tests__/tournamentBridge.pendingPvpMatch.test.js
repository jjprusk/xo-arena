// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Pending-PVP-match registry — Redis-backed shared store across backend
 * processes. Replaces the per-process in-memory Map that diverged on
 * multi-machine prod deploys (rolling restart / autoscale-up / pub/sub
 * subscription gap → user2's claim 404'd from a machine that never saw the
 * `tournament:match:ready` event).
 *
 * These tests run against the in-memory fallback (REDIS_URL unset) — the
 * fallback uses the same get/set/delete contract so the test is
 * representative of behavior, just not of cross-process sharing. The
 * cross-process guarantee is provided by Redis itself when REDIS_URL is
 * configured (validated end-to-end by tournament-2human-match-claim.spec.js
 * on a 2-machine staging environment).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// Force the in-memory fallback path. The module reads REDIS_URL at first
// `getRedisClient()` call, so unsetting it before the import is enough.
const originalRedisUrl = process.env.REDIS_URL
delete process.env.REDIS_URL

vi.mock('../db.js', () => ({ default: { user: { findUnique: vi.fn() } } }))
vi.mock('../notificationBus.js', () => ({ dispatch: vi.fn() }))
vi.mock('../eventStream.js', () => ({ appendToStream: vi.fn() }))
vi.mock('../../realtime/botGameRunner.js', () => ({
  botGameRunner: { startGame: vi.fn() },
}))
vi.mock('../../services/journeyService.js', () => ({ completeStep: vi.fn() }))
vi.mock('../../services/discoveryRewardsService.js', () => ({ grantDiscoveryReward: vi.fn() }))
vi.mock('../../config/coachingCardRules.js', () => ({ pickCoachingCard: vi.fn() }))

const {
  getPendingPvpMatch,
  setPendingPvpMatch,
  setPendingPvpMatchSlug,
  deletePendingPvpMatch,
  getPendingPvpMatchCount,
  _resetPendingPvpMatchesForTest,
} = await import('../tournamentBridge.js')

beforeEach(() => {
  _resetPendingPvpMatchesForTest()
})

afterAll(() => {
  if (originalRedisUrl) process.env.REDIS_URL = originalRedisUrl
})

describe('pending PVP match registry', () => {
  it('returns null for an unknown matchId', async () => {
    expect(await getPendingPvpMatch('m1')).toBeNull()
  })

  it('returns null for a falsy matchId without throwing', async () => {
    expect(await getPendingPvpMatch('')).toBeNull()
    expect(await getPendingPvpMatch(null)).toBeNull()
  })

  it('round-trips a fresh entry', async () => {
    await setPendingPvpMatch('m1', {
      tournamentId:       't1',
      participant1UserId: 'ba_alice',
      participant2UserId: 'ba_bob',
      bestOfN:            3,
      slug:               null,
    })
    const got = await getPendingPvpMatch('m1')
    expect(got).toMatchObject({
      tournamentId:       't1',
      participant1UserId: 'ba_alice',
      participant2UserId: 'ba_bob',
      bestOfN:            3,
      slug:               null,
    })
  })

  it('setPendingPvpMatchSlug updates only the slug field', async () => {
    await setPendingPvpMatch('m1', {
      tournamentId:       't1',
      participant1UserId: 'ba_alice',
      participant2UserId: 'ba_bob',
      bestOfN:            1,
      slug:               null,
    })
    await setPendingPvpMatchSlug('m1', 'abc-slug')

    const got = await getPendingPvpMatch('m1')
    expect(got?.slug).toBe('abc-slug')
    // Other fields preserved
    expect(got?.bestOfN).toBe(1)
    expect(got?.participant1UserId).toBe('ba_alice')
  })

  it('setPendingPvpMatchSlug(null) clears the slug for the disconnect-mid-claim case', async () => {
    await setPendingPvpMatch('m1', {
      tournamentId:       't1',
      participant1UserId: 'ba_alice',
      participant2UserId: 'ba_bob',
      bestOfN:            1,
      slug:               'temp',
    })
    await setPendingPvpMatchSlug('m1', null)
    expect((await getPendingPvpMatch('m1'))?.slug).toBeNull()
  })

  it('setPendingPvpMatchSlug on a missing key is a no-op (does not resurrect)', async () => {
    await setPendingPvpMatchSlug('never-existed', 'ghost')
    expect(await getPendingPvpMatch('never-existed')).toBeNull()
  })

  it('deletePendingPvpMatch removes the entry', async () => {
    await setPendingPvpMatch('m1', {
      tournamentId:       't1',
      participant1UserId: 'ba_alice',
      participant2UserId: 'ba_bob',
      bestOfN:            1,
      slug:               null,
    })
    await deletePendingPvpMatch('m1')
    expect(await getPendingPvpMatch('m1')).toBeNull()
  })

  it('getPendingPvpMatchCount tracks set/delete', async () => {
    expect(await getPendingPvpMatchCount()).toBe(0)
    await setPendingPvpMatch('m1', { tournamentId: 't', participant1UserId: 'a', participant2UserId: 'b', bestOfN: 1, slug: null })
    await setPendingPvpMatch('m2', { tournamentId: 't', participant1UserId: 'c', participant2UserId: 'd', bestOfN: 1, slug: null })
    expect(await getPendingPvpMatchCount()).toBe(2)
    await deletePendingPvpMatch('m1')
    expect(await getPendingPvpMatchCount()).toBe(1)
  })

  it('coerces bestOfN string back to number on read (Redis-shape compatibility)', async () => {
    // Redis stores all hash field values as strings. The fallback writer
    // mirrors that round-trip so consumers downstream don't get a string
    // where they expect a number.
    await setPendingPvpMatch('m1', {
      tournamentId:       't1',
      participant1UserId: 'ba_alice',
      participant2UserId: 'ba_bob',
      bestOfN:            '5', // intentionally string
      slug:               null,
    })
    const got = await getPendingPvpMatch('m1')
    expect(typeof got?.bestOfN).toBe('number')
    expect(got?.bestOfN).toBe(5)
  })
})
