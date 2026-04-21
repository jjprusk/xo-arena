// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * useHeartbeat — periodically POST /api/v1/presence/heartbeat to keep the
 * current user marked "online" on the backend. Paused while the tab is
 * hidden (no point in signaling presence while backgrounded), resumed on
 * visibility change and window focus.
 *
 * Cookie-based auth: the landing dev server proxies /api/* to the backend,
 * and the BA session cookie travels with fetch by default (same origin).
 * No token plumbing required.
 *
 * Rolling-window guarantee: we also fire one heartbeat immediately on mount
 * / resume so the server's TTL never expires before the first interval tick
 * (which would briefly drop the user from the online list).
 */
import { useEffect } from 'react'
import { isTier2SseEnabled } from './useEventStream.js'

const HEARTBEAT_INTERVAL_MS = 15_000

export function useHeartbeat({ enabled = true } = {}) {
  useEffect(() => {
    if (!isTier2SseEnabled() || !enabled) return
    if (typeof document === 'undefined') return

    let timer = null
    let cancelled = false

    async function beat() {
      if (cancelled) return
      if (document.hidden) return
      try {
        await fetch('/api/v1/presence/heartbeat', {
          method: 'POST',
          credentials: 'include',
        })
      } catch { /* offline or auth gone — next interval retries */ }
    }

    function start() {
      if (timer) return
      beat()  // fire immediately so presence doesn't lapse
      timer = setInterval(beat, HEARTBEAT_INTERVAL_MS)
    }
    function stop() {
      if (timer) { clearInterval(timer); timer = null }
    }

    function onVis() {
      if (document.hidden) stop()
      else start()
    }

    start()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', start)
    window.addEventListener('blur', () => {}) // explicit no-op; visibilitychange covers the real drop

    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', start)
    }
  }, [enabled])
}
