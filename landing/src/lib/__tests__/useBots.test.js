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

const BOTS = [
  { id: 'b_a', displayName: 'Sterling One',  botOwnerId: 'u1', botProvisional: false, gameElo: [{ rating: 1500 }], botGamesPlayed: 50 },
  { id: 'b_b', displayName: 'sterling two',  botOwnerId: 'u1', botProvisional: false, gameElo: [{ rating: 1700 }], botGamesPlayed: 30 },
  { id: 'b_c', displayName: 'Rookie Bot',    botOwnerId: 'u2', botProvisional: true,  gameElo: [{ rating: 1200 }], botGamesPlayed: 4  },
  { id: 'b_d', displayName: 'Built-in Easy', botOwnerId: null, botProvisional: false, gameElo: [{ rating: 1000 }], botGamesPlayed: 100 },
  { id: 'b_e', displayName: 'No-rating Bot', botOwnerId: 'u3', botProvisional: false, gameElo: [],                  botGamesPlayed: 0  },
]

describe('_applyFiltersForTest', () => {
  it('returns all bots when filters are empty', () => {
    expect(_applyFiltersForTest(BOTS, {}, null)).toHaveLength(BOTS.length)
  })

  it('owner: "mine" returns only bots owned by currentUserId', () => {
    const out = _applyFiltersForTest(BOTS, { owner: 'mine' }, 'u1')
    expect(out.map(b => b.id)).toEqual(['b_a', 'b_b'])
  })

  it('owner: "mine" returns [] for guests (currentUserId null)', () => {
    expect(_applyFiltersForTest(BOTS, { owner: 'mine' }, null)).toEqual([])
  })

  it('owner: "community" returns only bots without an owner', () => {
    const out = _applyFiltersForTest(BOTS, { owner: 'community' }, 'u1')
    expect(out.map(b => b.id)).toEqual(['b_d'])
  })

  it('ownerId overrides owner and returns exact-owner matches', () => {
    const out = _applyFiltersForTest(BOTS, { ownerId: 'u2', owner: 'mine' }, 'u1')
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
      'u1',
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
      useBots({ owner: 'community' }, 'u1'),
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
