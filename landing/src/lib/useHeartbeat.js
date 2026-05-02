// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * useHeartbeat — periodically POST /api/v1/presence/heartbeat to keep the
 * current user marked "online" on the backend. Paused while the tab is
 * hidden (no point in signaling presence while backgrounded), resumed on
 * visibility change and window focus.
 *
 * Bearer-token auth: the heartbeat used to rely on `credentials: 'include'`
 * (cookie-based) and the BA session cookie travelling with fetch via the
 * dev server's /api proxy. That broke in dev environments where the cookie
 * never reached the proxy (same-origin nominally, but `secure` cookies are
 * not set on plain HTTP), so every heartbeat 401'd in the console even for
 * a signed-in user. We now mirror the rest of the app and send the JWT
 * from getToken() as Authorization: Bearer.
 *
 * Rolling-window guarantee: we also fire one heartbeat immediately on mount
 * / resume so the server's TTL never expires before the first interval tick
 * (which would briefly drop the user from the online list).
 */
import { useEffect } from 'react'
import { getToken } from './getToken.js'

const HEARTBEAT_INTERVAL_MS = 15_000

export function useHeartbeat({ enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return
    if (typeof document === 'undefined') return

    let timer = null
    let cancelled = false

    async function beat() {
      if (cancelled) return
      if (document.hidden) return
      try {
        const token = await getToken()
        if (!token || cancelled) return
        await fetch('/api/v1/presence/heartbeat', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
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
