// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { useState, useEffect } from 'react'

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

// Imperative refresh — call after sign-in/sign-up so the session updates
// immediately instead of waiting for the 60-second poll cycle.
const _refreshListeners = []
export function triggerSessionRefresh() {
  _refreshListeners.forEach(fn => fn())
}

// ── Shared singleton ────────────────────────────────────────────────────────
//
// Before this dedup: every component using useOptimisticSession() fired its
// own `fetch('/api/session')` on cold mount. On the warm-anon /play landing,
// AppLayout + PlayPage + HomePage + JourneyCard + ProfileMenu + auth gates
// stacked to **8 parallel `/api/session` GETs** (prod waterfall, 2026-05-16).
// Each ~100–290 ms, several of which gate React renders — ~150–250 ms of
// wall-clock that dropped straight onto tReady.
//
// After: one module-level fetch + one 60-second poller, regardless of how
// many components subscribe. Subscribers attach a listener and receive every
// state update. Cold-mount cost on /play drops to **one** `/api/session` GET
// (Future_Ideas tReady follow-up, item 1).
//
// State lifecycle:
//   • First subscriber mounts → kick off initial fetch + start poll timer.
//   • Each subscriber attaches a listener; receives current state immediately
//     plus every settle/refresh thereafter.
//   • Last subscriber unmounts → stop poll timer (no leaked fetches).
//   • triggerSessionRefresh() (called after sign-in/sign-up) restarts the
//     fetch immediately and notifies every subscriber.

let _state         = readCache()         // null | { user, session }
let _pending       = _state === null
let _inflight      = null                // in-flight Promise (dedups parallel callers)
let _timerId       = null
let _subscribers   = 0
const _listeners   = new Set()           // fn(state, isPending) → void

function notify() {
  for (const fn of _listeners) fn(_state, _pending)
}

async function _fetchOnce() {
  // Share one HTTP round-trip across any number of concurrent first mounts.
  if (_inflight) return _inflight
  _inflight = (async () => {
    try {
      const res = await fetch('/api/session', { credentials: 'include' })
      if (!res.ok) return null
      const json = await res.json()
      return json?.user ? json : null
    } catch {
      return null
    }
  })()
  try {
    const session = await _inflight
    _state   = session
    _pending = false
    writeCache(session)
    notify()
    return session
  } finally {
    _inflight = null
  }
}

function _startPoll() {
  if (_timerId) return
  const tick = async () => {
    await _fetchOnce()
    _timerId = setTimeout(tick, POLL_MS)
  }
  // Kick off the first probe immediately; chain the poll off its settle.
  _fetchOnce().then(() => { _timerId = setTimeout(tick, POLL_MS) })
}

function _stopPoll() {
  if (_timerId) { clearTimeout(_timerId); _timerId = null }
}

// Imperative refresh entry — restart the fetch immediately, propagate to all
// subscribers. Used after sign-in / sign-up so session state updates without
// waiting for the 60-second poll. Idempotent under in-flight dedup.
_refreshListeners.push(() => {
  _stopPoll()
  if (_subscribers > 0) _startPoll()
})

export function useOptimisticSession() {
  const [data, setData]           = useState(_state)
  const [isPending, setIsPending] = useState(_pending)

  useEffect(() => {
    const listener = (state, pending) => {
      setData(state)
      setIsPending(pending)
    }
    _listeners.add(listener)
    _subscribers += 1
    // Sync to current shared state (covers fast-mount-after-fetch cases).
    listener(_state, _pending)
    // Start polling if we're the first subscriber.
    if (_subscribers === 1) _startPoll()
    return () => {
      _listeners.delete(listener)
      _subscribers -= 1
      if (_subscribers === 0) _stopPoll()
    }
  }, [])

  return { data, isPending }
}

// Test hook — flush singleton state. Not used in prod.
export function _resetForTests() {
  _stopPoll()
  _state       = null
  _pending     = true
  _inflight    = null
  _listeners.clear()
  _subscribers = 0
  try { localStorage.removeItem(CACHE_KEY) } catch {}
}
