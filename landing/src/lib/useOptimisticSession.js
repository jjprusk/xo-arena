// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { useState, useEffect, useRef } from 'react'

const CACHE_KEY = 'aiarena_session_cache'
const POLL_MS   = 60_000   // re-check session every 60 s

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) } catch { return null }
}
function writeCache(data) {
  try {
    data ? localStorage.setItem(CACHE_KEY, JSON.stringify(data)) : localStorage.removeItem(CACHE_KEY)
  } catch {}
}

export function clearSessionCache() {
  try { localStorage.removeItem(CACHE_KEY) } catch {}
}

// Fetch the session via /api/session — always returns 200 so browsers
// don't log "401 Unauthorized" in the console for unauthenticated users.
async function fetchSession() {
  try {
    const res = await fetch('/api/session', { credentials: 'include' })
    if (!res.ok) return null
    const json = await res.json()
    return json?.user ? json : null    // normalise to { user, session } | null
  } catch {
    return null
  }
}

export function useOptimisticSession() {
  const [data, setData]           = useState(() => readCache())
  const [isPending, setIsPending] = useState(true)
  const timerRef                  = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function check() {
      const session = await fetchSession()
      if (cancelled) return
      writeCache(session)
      setData(session)
      setIsPending(false)
      timerRef.current = setTimeout(check, POLL_MS)
    }

    check()
    return () => {
      cancelled = true
      clearTimeout(timerRef.current)
    }
  }, [])

  return { data, isPending }
}
