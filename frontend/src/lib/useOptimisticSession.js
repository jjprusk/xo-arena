// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { useState, useEffect } from 'react'
import { authClient } from './auth-client.js'

const CACHE_KEY = 'xo_session_cache'

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeCache(data) {
  try {
    if (data) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data))
    } else {
      localStorage.removeItem(CACHE_KEY)
    }
  } catch {}
}

export function clearSessionCache() {
  try { localStorage.removeItem(CACHE_KEY) } catch {}
}

/**
 * Drop-in replacement for authClient.useSession().
 *
 * On the first render for returning users, returns the cached session
 * (isPending: false) so the UI paints immediately without a spinner.
 * The real network fetch runs in the background; when it resolves, the
 * cache is refreshed and the component re-renders only if the data changed.
 *
 * For first-time visitors (no cache) the behaviour is identical to the
 * original useSession — isPending:true until the fetch resolves.
 */
export function useOptimisticSession() {
  const [cached, setCached] = useState(() => readCache())
  const { data, isPending } = authClient.useSession()

  useEffect(() => {
    if (!isPending) {
      writeCache(data ?? null)
      setCached(data ?? null)
    }
  }, [data, isPending])

  // Serve the cache synchronously while the real fetch is in-flight
  if (cached && isPending) {
    return { data: cached, isPending: false }
  }

  return { data: data ?? null, isPending }
}
