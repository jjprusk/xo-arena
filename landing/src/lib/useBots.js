// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * useBots — reusable client-side hook over `GET /api/v1/bots`.
 *
 * One fetch per session via `useSWRish`; filtering happens client-side
 * over the cached list so changing filter inputs doesn't re-hit the
 * network. The endpoint itself is server-side cached (BOTS_TTL_MS) and
 * the swr layer adds localStorage persistence on top of that.
 *
 * Filter shape (all optional):
 *   gameId   — string (currently 'xo'; reserved for multi-game)
 *   eloMin   — number  (filter by gameElo.rating ≥ eloMin)
 *   eloMax   — number  (filter by gameElo.rating ≤ eloMax)
 *   owner    — 'mine' | 'community' | 'all'  (community = ownerless built-ins)
 *   ownerId  — string  (filter to a specific owner — overrides `owner`)
 *   search   — string  (case-insensitive substring match on displayName)
 *
 * The hook is intentionally read-only and game-agnostic. Phase B
 * surfaces (BotDirectoryPage, RankingsPage, profile, picker) all
 * consume the same hook with different filter combos.
 */
import { useMemo } from 'react'
import { useSWRish } from './swr.js'
import { api } from './api.js'

export const BOTS_FETCH_KEY = 'bots:list:v1'

function applyFilters(bots, filters, currentUserId) {
  if (!Array.isArray(bots)) return []
  let out = bots

  if (filters.ownerId) {
    out = out.filter(b => b.botOwnerId === filters.ownerId)
  } else if (filters.owner === 'mine') {
    if (!currentUserId) return []  // guests have no "mine"
    out = out.filter(b => b.botOwnerId === currentUserId)
  } else if (filters.owner === 'community') {
    out = out.filter(b => !b.botOwnerId)
  }
  // 'all' or undefined → no owner filter

  if (filters.eloMin != null || filters.eloMax != null) {
    const min = filters.eloMin ?? -Infinity
    const max = filters.eloMax ?? Infinity
    out = out.filter(b => {
      const rating = b.gameElo?.[0]?.rating ?? null
      if (rating == null) return false
      return rating >= min && rating <= max
    })
  }

  if (filters.search && filters.search.trim()) {
    const needle = filters.search.trim().toLowerCase()
    out = out.filter(b => (b.displayName ?? '').toLowerCase().includes(needle))
  }

  return out
}

/**
 * @param {object}  filters         (optional) see file header for shape
 * @param {string?} currentUserId   domain User.id of the caller, used by
 *                                  `owner: 'mine'`. Null/undefined for
 *                                  guests — guest "mine" returns [].
 * @returns {{ bots, allBots, isLoading, isStale, error, refresh }}
 */
export function useBots(filters = {}, currentUserId = null) {
  const { data, error, isLoading, isStale, refresh } = useSWRish(
    BOTS_FETCH_KEY,
    () => api.bots.list({}),
  )
  const allBots = data?.bots ?? []
  const bots = useMemo(
    () => applyFilters(allBots, filters, currentUserId),
    // The filter object is created inline by callers; depend on its
    // primitive fields rather than identity to avoid spurious recomputes.
    [allBots, filters.ownerId, filters.owner, filters.eloMin, filters.eloMax, filters.search, currentUserId],
  )
  return { bots, allBots, isLoading, isStale, error, refresh }
}

// Test-only export — verified directly so the hook tests don't have to
// re-derive every filter combination through the SWR machinery.
export const _applyFiltersForTest = applyFilters
