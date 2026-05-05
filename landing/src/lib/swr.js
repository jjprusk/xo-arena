// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * useSWRish — minimal stale-while-revalidate hook (Phase 20.3).
 *
 * Reads from `localStorage` synchronously on first render so cached
 * data paints in the same frame as the spinner would have. Then fires
 * the fetcher; when fresh data lands, swaps it in and writes the cache.
 *
 * Compared to a real SWR library this is intentionally tiny:
 *   - no global cache (per-key localStorage entry only)
 *   - no focus / reconnect revalidation (the few pages that want it
 *     already drive their own re-fetch on SSE events)
 *   - no suspense, no mutate(), no dedupe across hooks
 *
 * What it gives you:
 *
 *   const { data, isLoading, isStale, error, refresh } = useSWRish(
 *     `leaderboard:${period}:${mode}`,        // stable key
 *     () => api.get(`/leaderboard/${period}/${mode}`),
 *     { maxAgeMs: 5 * 60_000 },
 *   )
 *
 *   - `data`        — cached value (synchronously available on mount)
 *                     or fresh value once the fetcher resolves; null
 *                     if neither is ready yet
 *   - `isLoading`   — true on cold load (no cache, fetch in flight)
 *                     OR while the first revalidation runs after a
 *                     stale-cache hit; flips false on first success
 *   - `isStale`     — true while serving cached-but-revalidating data
 *   - `error`       — last fetcher rejection (or null)
 *   - `refresh`     — re-run the fetcher imperatively
 *   - `mutate(next)` — overwrite the cached data without refetching.
 *                     `next` can be a value or `(prev) => updated` for
 *                     functional updates. Used for optimistic UI on
 *                     local mutations (e.g. TablesPage create).
 *
 * The fetcher reference can change between renders (typical inline
 * arrow). The hook re-runs when **key** changes; fetcher is captured
 * via ref so a fresh closure on each render doesn't trigger a refetch.
 *
 * See doc/Performance_Plan_v2.md §Phase 20.3.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const CACHE_PREFIX = 'xo_swr_'
const DEFAULT_MAX_AGE_MS = 5 * 60_000

function readCache(cacheKey, maxAgeMs) {
  try {
    const raw = localStorage.getItem(cacheKey)
    if (!raw) return null
    const entry = JSON.parse(raw)
    if (typeof entry?.ts !== 'number') return null
    if (Date.now() - entry.ts >= maxAgeMs) return null
    return entry.data
  } catch {
    return null
  }
}

function writeCache(cacheKey, data) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() }))
  } catch {
    // Quota / private mode — silent. The hook keeps working in-memory.
  }
}

export function useSWRish(key, fetcher, options = {}) {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const cacheKey = CACHE_PREFIX + key

  // Synchronous cache read on first render so cached data paints in
  // the same frame the component mounts in (same trick as the
  // existing `cachedFetch` in api.js).
  const initial = readCache(cacheKey, maxAgeMs)
  const [data, setData] = useState(initial)
  const [error, setError] = useState(null)
  const [isLoading, setIsLoading] = useState(initial == null)
  const [isStale, setIsStale] = useState(initial != null)

  // Capture the fetcher in a ref so re-renders with new closures
  // don't retrigger the fetch effect.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  // Track liveness so a fetch resolved after unmount doesn't setState.
  const aliveRef = useRef(true)

  const run = useCallback(async () => {
    try {
      const fresh = await fetcherRef.current()
      if (!aliveRef.current) return
      setData(fresh)
      setError(null)
      setIsLoading(false)
      setIsStale(false)
      writeCache(cacheKey, fresh)
    } catch (err) {
      if (!aliveRef.current) return
      setError(err)
      setIsLoading(false)
      // Leave isStale unchanged — caller can keep showing the cached
      // data while error is true, which is usually nicer than blanking.
    }
  }, [cacheKey])

  const mutate = useCallback((next) => {
    setData(prev => {
      const updated = typeof next === 'function' ? next(prev) : next
      writeCache(cacheKey, updated)
      return updated
    })
    // Optimistic mutates clear the stale flag — caller is asserting
    // the new value is the truth. Background revalidate is still
    // available via refresh() if the caller wants to confirm.
    setIsStale(false)
    setIsLoading(false)
    setError(null)
  }, [cacheKey])

  useEffect(() => {
    aliveRef.current = true
    // Re-read the cache for the *new* key so prior-key data isn't
    // shown when consumers swap keys (filters, etc.).
    const cached = readCache(cacheKey, maxAgeMs)
    setData(cached)
    setError(null)
    setIsLoading(cached == null)
    setIsStale(cached != null)
    run()
    return () => { aliveRef.current = false }
    // `key` is the source of truth for "has the input changed". Any
    // useful change to `cacheKey` or `maxAgeMs` flows from a key change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { data, error, isLoading, isStale, refresh: run, mutate }
}
