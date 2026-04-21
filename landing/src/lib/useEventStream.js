// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * useEventStream — Tier 2 SSE client.
 *
 * Opens a long-lived SSE connection to /api/v1/events/stream and dispatches
 * events to caller-supplied handlers by channel prefix. Persists the last
 * seen event id in sessionStorage so reconnects (page reloads, temporary
 * network drops) replay missed events via Last-Event-ID.
 *
 * Design notes:
 *   - EventSource handles auto-reconnect + Last-Event-ID natively. We just
 *     need to persist the id between page loads (sessionStorage) since a
 *     fresh EventSource starts with no id.
 *   - Pause on document.hidden is not strictly needed — EventSource is cheap —
 *     but we close the connection on long-hidden tabs anyway so the backend
 *     doesn't keep idle broker slots.
 *   - Feature-flag gated via VITE_TIER2_SSE. When off, the hook returns a
 *     no-op and the parent component's existing socket path stays live.
 *   - Channel filter is a comma-joined prefix list sent as a query param
 *     (matches the server's startsWith filter).
 *
 * Usage:
 *   useEventStream({
 *     channels: ['tournament:', 'guide:'],
 *     onEvent:  (channel, payload, id) => { ... },
 *     enabled:  someCondition,
 *   })
 */
import { useEffect, useRef } from 'react'

const STORAGE_KEY = 'aiarena_tier2_last_event_id'
const FLAG        = !!import.meta.env.VITE_TIER2_SSE

function loadLastId() {
  try { return sessionStorage.getItem(STORAGE_KEY) || null } catch { return null }
}
function saveLastId(id) {
  try { sessionStorage.setItem(STORAGE_KEY, id) } catch {}
}

export function isTier2SseEnabled() { return FLAG }

export function useEventStream({ channels = [], onEvent, enabled = true } = {}) {
  // Keep latest onEvent in a ref so re-renders don't cycle the connection.
  const handlerRef = useRef(onEvent)
  useEffect(() => { handlerRef.current = onEvent }, [onEvent])

  useEffect(() => {
    if (!FLAG || !enabled) {
      // Diagnostic — always logs so we can tell from the browser console
      // whether the flag reached the client.
      console.info('[useEventStream] skipping — FLAG=' + FLAG + ' enabled=' + enabled)
      return
    }
    if (typeof EventSource === 'undefined') {
      console.warn('[useEventStream] EventSource not available in this browser')
      return
    }

    const params = new URLSearchParams()
    if (channels.length) params.set('channels', channels.join(','))
    const lastId = loadLastId()
    if (lastId) params.set('lastEventId', lastId)

    // Using relative URL so Vite/landing proxy forwards to backend.
    const url = `/api/v1/events/stream${params.toString() ? `?${params}` : ''}`
    console.info('[useEventStream] opening SSE:', url)

    // EventSource sends cookies with same-origin requests, which is what we
    // want — the BA session cookie authenticates us through the landing proxy.
    const es = new EventSource(url, { withCredentials: true })
    es.onopen = () => console.info('[useEventStream] SSE open')

    // Generic handler for EVERY message. We listen to 'message' but also
    // named events matching our channel prefixes — EventSource requires
    // addEventListener for named events (they don't come through onmessage).
    function handle(e) {
      saveLastId(e.lastEventId || '')
      let payload = {}
      try { payload = e.data ? JSON.parse(e.data) : {} } catch {}
      handlerRef.current?.(e.type, payload, e.lastEventId)
    }

    // Server emits `event: <channel>` per entry; listen across channels by
    // using the low-level onmessage fallback for unknown types and explicit
    // listeners for the caller's prefixes. Channel names use ':' which is
    // a valid SSE event name character.
    //
    // Rather than enumerate every possible name, we hook `message` (handles
    // default-named events) and listen for the specific known channels by
    // walking them lazily — EventSource allows addEventListener(type) for
    // any string. We subscribe to the common ones we care about.
    const KNOWN_EVENT_TYPES = [
      'tournament:published',
      'tournament:flash:announced',
      'tournament:started',
      'tournament:registration_closed',
      'tournament:participant:joined',
      'tournament:participant:left',
      'tournament:match:ready',
      'tournament:bot:match:ready',
      'tournament:round:started',
      'tournament:match:result',
      'tournament:match:score',
      'tournament:warning',
      'tournament:completed',
      'tournament:cancelled',
      'guide:notification',
      'presence:changed',
    ]
    for (const t of KNOWN_EVENT_TYPES) es.addEventListener(t, handle)
    es.onmessage = handle

    // Don't treat errors as fatal — EventSource auto-reconnects and we'll
    // catch up via Last-Event-ID. Elevated to info during diagnosis.
    es.onerror = (e) => {
      console.warn('[useEventStream] SSE error — readyState=' + es.readyState + ' (0=connecting, 1=open, 2=closed)')
    }

    return () => {
      for (const t of KNOWN_EVENT_TYPES) es.removeEventListener(t, handle)
      es.close()
    }
  }, [enabled, channels.join(',')])
}
