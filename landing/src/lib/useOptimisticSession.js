import { useState, useEffect } from 'react'
import { authClient } from './auth-client.js'

const CACHE_KEY = 'aiarena_session_cache'

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

export function useOptimisticSession() {
  const [cached, setCached] = useState(() => readCache())
  const { data, isPending } = authClient.useSession()

  useEffect(() => {
    if (!isPending) {
      writeCache(data ?? null)
      setCached(data ?? null)
    }
  }, [data, isPending])

  if (cached && isPending) return { data: cached, isPending: false }
  return { data: data ?? null, isPending }
}
