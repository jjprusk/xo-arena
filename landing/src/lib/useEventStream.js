// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * useEventStream — Tier 2 SSE client.
 *
 * Opens a long-lived SSE connection to /api/v1/events/stream and dispatches
 * events to caller-supplied handlers by channel prefix. Persists the last
 * seen event id in sessionStorage so reconnects (page reloads, temporary
 * network drops) replay missed events via Last-Event-ID.
 *
 * EventSource handles auto-reconnect + Last-Event-ID natively — we just
 * persist the id between page loads since a fresh EventSource starts with
 * no id. Channel filter is a comma-joined prefix list sent as a query param
 * (matches the server's startsWith filter).
 *
 * Usage:
 *   useEventStream({
 *     channels: ['tournament:', 'guide:'],
 *     onEvent:  (channel, payload, id) => { ... },
 *     enabled:  someCondition,
 *   })
 */
import { useEffect, useRef } from 'react'
import { setSseSession, clearSseSession } from './rtSession.js'

const STORAGE_KEY = 'aiarena_tier2_last_event_id'

function loadLastId() {
  try { return sessionStorage.getItem(STORAGE_KEY) || null } catch { return null }
}
function saveLastId(id) {
  try { sessionStorage.setItem(STORAGE_KEY, id) } catch {}
}

/**
 * Open an SSE connection to the Tier 2 event stream and dispatch events
 * to the caller's onEvent handler.
 *
 * Options:
 *   channels — server-side prefix filter (e.g. ['guide:', 'presence:'])
 *   eventTypes — extra named event types to register listeners for. Required
 *     for dynamic, per-user channel names like `user:<id>:idle` that can't
 *     live in the static KNOWN list.
 *   onEvent(channel, payload, eventId) — called once per delivered event.
 *   enabled — defer opening the EventSource until truthy.
 */
export function useEventStream({ channels = [], eventTypes = [], onEvent, enabled = true } = {}) {
  // Keep latest onEvent in a ref so re-renders don't cycle the connection.
  const handlerRef = useRef(onEvent)
  useEffect(() => { handlerRef.current = onEvent }, [onEvent])

  useEffect(() => {
    if (!enabled) return
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

    // First frame from the server is `event: session\ndata: {sseSessionId}`.
    // Stash it so /api/v1/rt/* POSTs can attach the X-SSE-Session header
    // (Realtime_Migration_Plan.md C1). Don't propagate to the user-supplied
    // onEvent — sessions are infra, not application events.
    function onSession(e) {
      try {
        const { sseSessionId } = JSON.parse(e.data || '{}')
        if (sseSessionId) setSseSession(sseSessionId)
      } catch {}
    }
    es.addEventListener('session', onSession)

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
    for (const t of eventTypes) es.addEventListener(t, handle)
    es.onmessage = handle

    // Don't treat errors as fatal — EventSource auto-reconnects and we'll
    // catch up via Last-Event-ID. Elevated to info during diagnosis.
    es.onerror = (e) => {
      console.warn('[useEventStream] SSE error — readyState=' + es.readyState + ' (0=connecting, 1=open, 2=closed)')
    }

    return () => {
      for (const t of KNOWN_EVENT_TYPES) es.removeEventListener(t, handle)
      for (const t of eventTypes) es.removeEventListener(t, handle)
      es.removeEventListener('session', onSession)
      // Clear the cached session id — a new one will be minted when the
      // next EventSource opens. Without this, a brief gap could let an
      // /api/v1/rt/* POST fire with a stale id and 409.
      clearSseSession()
      es.close()
    }
  }, [enabled, channels.join(','), eventTypes.join(',')])
}

// Re-exported so other modules can extend the listener set in future phases
// without modifying useEventStream itself.
export const KNOWN_SSE_EVENT_TYPES = [
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
