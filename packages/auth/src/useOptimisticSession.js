import { useState, useEffect } from 'react'

/**
 * Creates a useOptimisticSession hook bound to a specific Better Auth client.
 *
 * The returned hook is a drop-in replacement for authClient.useSession() that
 * serves cached session data from localStorage on first render, so returning
 * users see the UI immediately without a spinner while the network fetch runs.
 *
 * @param {object} authClient - Better Auth client instance (from createAuthClient).
 * @param {string} [cacheKey] - localStorage key. Use a unique key per site to
 *                              avoid cache collisions across subdomains.
 * @returns {function} useOptimisticSession hook
 */
export function createUseOptimisticSession(authClient, cacheKey = 'xo_session_cache') {
  function readCache() {
    try {
      const raw = localStorage.getItem(cacheKey)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }

  function writeCache(data) {
    try {
      if (data) localStorage.setItem(cacheKey, JSON.stringify(data))
      else localStorage.removeItem(cacheKey)
    } catch {}
  }

  return function useOptimisticSession() {
    const [cached, setCached] = useState(() => readCache())
    const { data, isPending } = authClient.useSession()

    useEffect(() => {
      if (!isPending) {
        writeCache(data ?? null)
        setCached(data ?? null)
      }
    }, [data, isPending])

    if (cached && isPending) {
      return { data: cached, isPending: false }
    }
    return { data: data ?? null, isPending }
  }
}

/**
 * Clears the localStorage session cache for the given key.
 * Call this on sign-out so stale session data is not served on next visit.
 *
 * @param {string} [cacheKey]
 */
export function clearSessionCache(cacheKey = 'xo_session_cache') {
  try { localStorage.removeItem(cacheKey) } catch {}
}
