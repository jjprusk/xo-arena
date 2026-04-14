// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Module-level cache for the community bot config used by the quick-play flow.
 * Prefetch from any page that shows a "Play vs Bot" button; consume in PlayPage
 * to skip the round-trip fetch when the user actually navigates to /play.
 */
import { api } from './api.js'

const BUILTIN_ORDER = { Rusty: 0, Copper: 1, Sterling: 2, Magnus: 3 }
const TTL_MS        = 5 * 60 * 1000   // 5 minutes

let _cache    = null   // { botUserId, botSkillId } | null
let _fetchedAt = 0
let _inflight  = null  // in-flight Promise so concurrent callers share one request

function isStale() {
  return Date.now() - _fetchedAt > TTL_MS
}

/**
 * Resolve the first built-in community bot for the XO game.
 * Returns the cached value instantly on cache hit; otherwise fetches once.
 * Multiple concurrent callers share a single in-flight request.
 */
export async function getCommunityBot() {
  if (_cache && !isStale()) return _cache
  if (!_inflight) {
    _inflight = api.bots.list({ gameId: 'xo' })
      .then(res => {
        const bots    = res.bots ?? []
        const builtIn = bots
          .filter(b => !b.botOwnerId)
          .sort((a, b) => (BUILTIN_ORDER[a.displayName] ?? 99) - (BUILTIN_ORDER[b.displayName] ?? 99))
        const target = builtIn[0] ?? bots[0]
        _cache     = target ? { botUserId: target.id, botSkillId: target.botModelId ?? null } : null
        _fetchedAt = Date.now()
        return _cache
      })
      .catch(() => null)
      .finally(() => { _inflight = null })
  }
  return _inflight
}

/** Fire-and-forget prefetch — call from any page that shows a "Play" button. */
export function prefetchCommunityBot() {
  if (_cache && !isStale()) return
  getCommunityBot().catch(() => {})
}
