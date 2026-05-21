// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tests for `useBots` + `_applyFiltersForTest`.
 *
 * Filtering is verified via the pure helper (no SWR machinery needed).
 * The hook integration is verified end-to-end with mocked api.bots.list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('../api.js', () => ({
  api: { bots: { list: vi.fn() } },
}))

import { api } from '../api.js'
import { useBots, _applyFiltersForTest } from '../useBots.js'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

// Each owned bot carries both `botOwnerId` (domain User.id) and
// `ownerBetterAuthId` (better-auth user id). The "mine" filter compares
// against the latter so it matches `session.user.id` from /api/session.
const BOTS = [
  { id: 'b_a', displayName: 'Sterling One',  botOwnerId: 'u1', ownerBetterAuthId: 'ba1', botProvisional: false, gameElo: [{ rating: 1500 }], botGamesPlayed: 50 },
  { id: 'b_b', displayName: 'sterling two',  botOwnerId: 'u1', ownerBetterAuthId: 'ba1', botProvisional: false, gameElo: [{ rating: 1700 }], botGamesPlayed: 30 },
  { id: 'b_c', displayName: 'Rookie Bot',    botOwnerId: 'u2', ownerBetterAuthId: 'ba2', botProvisional: true,  gameElo: [{ rating: 1200 }], botGamesPlayed: 4  },
  { id: 'b_d', displayName: 'Built-in Easy', botOwnerId: null, ownerBetterAuthId: null,  botProvisional: false, gameElo: [{ rating: 1000 }], botGamesPlayed: 100 },
  { id: 'b_e', displayName: 'No-rating Bot', botOwnerId: 'u3', ownerBetterAuthId: 'ba3', botProvisional: false, gameElo: [],                  botGamesPlayed: 0  },
]

describe('_applyFiltersForTest', () => {
  it('returns all bots when filters are empty', () => {
    expect(_applyFiltersForTest(BOTS, {}, null)).toHaveLength(BOTS.length)
  })

  it('owner: "mine" matches on ownerBetterAuthId, not the domain botOwnerId', () => {
    // currentUserId here is the better-auth id (`ba1`). Comparing against
    // the domain id `u1` would also have matched the legacy code path but
    // wouldn't have matched the actual session.user.id shape in prod.
    const out = _applyFiltersForTest(BOTS, { owner: 'mine' }, 'ba1')
    expect(out.map(b => b.id)).toEqual(['b_a', 'b_b'])
  })

  it('owner: "mine" does NOT match when caller passes the domain User.id', () => {
    // Regression guard: the bug we fixed was a domain-id-vs-BA-id mismatch
    // that silently returned [] for every signed-in user. If this assertion
    // ever fails, someone has re-introduced the old behaviour.
    expect(_applyFiltersForTest(BOTS, { owner: 'mine' }, 'u1')).toEqual([])
  })

  it('owner: "mine" returns [] for guests (currentUserId null)', () => {
    expect(_applyFiltersForTest(BOTS, { owner: 'mine' }, null)).toEqual([])
  })

  it('owner: "community" returns only bots without an owner', () => {
    const out = _applyFiltersForTest(BOTS, { owner: 'community' }, 'u1')
    expect(out.map(b => b.id)).toEqual(['b_d'])
  })

  it('ownerId overrides owner and returns exact-owner matches', () => {
    // `ownerId` is still keyed by the domain User.id (used by the bot
    // profile + admin paths where the caller has the domain id in hand).
    const out = _applyFiltersForTest(BOTS, { ownerId: 'u2', owner: 'mine' }, 'ba1')
    expect(out.map(b => b.id)).toEqual(['b_c'])
  })

  it('eloMin filters out lower ratings (no-rating bots are excluded)', () => {
    const out = _applyFiltersForTest(BOTS, { eloMin: 1500 }, null)
    expect(out.map(b => b.id).sort()).toEqual(['b_a', 'b_b'])
  })

  it('eloMin + eloMax form a closed range', () => {
    const out = _applyFiltersForTest(BOTS, { eloMin: 1100, eloMax: 1300 }, null)
    expect(out.map(b => b.id)).toEqual(['b_c'])
  })

  it('search is case-insensitive substring on displayName', () => {
    const out = _applyFiltersForTest(BOTS, { search: 'STERLING' }, null)
    expect(out.map(b => b.id).sort()).toEqual(['b_a', 'b_b'])
  })

  it('combines multiple filters', () => {
    const out = _applyFiltersForTest(
      BOTS,
      { owner: 'mine', search: 'two', eloMin: 1500 },
      'ba1',
    )
    expect(out.map(b => b.id)).toEqual(['b_b'])
  })

  it('returns [] cleanly for empty / non-array input', () => {
    expect(_applyFiltersForTest(null, {}, null)).toEqual([])
    expect(_applyFiltersForTest(undefined, {}, null)).toEqual([])
  })
})

describe('useBots — hook integration', () => {
  it('fetches once and exposes filtered + raw lists', async () => {
    api.bots.list.mockResolvedValueOnce({ bots: BOTS })

    const { result } = renderHook(() =>
      useBots({ owner: 'community' }, 'ba1'),
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(api.bots.list).toHaveBeenCalledTimes(1)
    expect(result.current.allBots).toHaveLength(BOTS.length)
    expect(result.current.bots.map(b => b.id)).toEqual(['b_d'])
  })

  it('surfaces fetch errors without crashing', async () => {
    api.bots.list.mockRejectedValueOnce(new Error('boom'))

    const { result } = renderHook(() => useBots({}, null))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error.message).toBe('boom')
  })
})
