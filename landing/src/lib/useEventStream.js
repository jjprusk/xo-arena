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
import { useEffect, useRef, useState } from 'react'
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

  // Hold the EventSource in state so a separate effect can attach/detach
  // listeners as `eventTypes` changes WITHOUT closing the connection. Without
  // this split, a Phase 7d caller that learns the table id mid-game (and
  // wants to add `table:<id>:state` listeners) would have to reopen the
  // EventSource — which mints a new session id and disposes the old session,
  // forfeiting the FORMING table the user just created.
  const [es, setEs] = useState(null)

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
    const newEs = new EventSource(url, { withCredentials: true })
    newEs.onopen = () => console.info('[useEventStream] SSE open')

    // First frame from the server is `event: session\ndata: {sseSessionId}`.
    function onSession(e) {
      try {
        const { sseSessionId } = JSON.parse(e.data || '{}')
        if (sseSessionId) setSseSession(sseSessionId)
      } catch {}
    }
    newEs.addEventListener('session', onSession)

    newEs.onerror = (e) => {
      console.warn('[useEventStream] SSE error — readyState=' + newEs.readyState + ' (0=connecting, 1=open, 2=closed)')
    }

    setEs(newEs)

    return () => {
      newEs.removeEventListener('session', onSession)
      clearSseSession()
      newEs.close()
      setEs(null)
    }
  }, [enabled, channels.join(',')])

  // Listener-management effect — attaches handlers for the requested
  // event types without touching the EventSource connection itself.
  useEffect(() => {
    if (!es) return
    function handle(e) {
      saveLastId(e.lastEventId || '')
      let payload = {}
      try { payload = e.data ? JSON.parse(e.data) : {} } catch {}
      handlerRef.current?.(e.type, payload, e.lastEventId)
    }
    for (const t of KNOWN_SSE_EVENT_TYPES) es.addEventListener(t, handle)
    for (const t of eventTypes) es.addEventListener(t, handle)
    es.onmessage = handle
    return () => {
      for (const t of KNOWN_SSE_EVENT_TYPES) es.removeEventListener(t, handle)
      for (const t of eventTypes) es.removeEventListener(t, handle)
      es.onmessage = null
    }
  }, [es, eventTypes.join(',')])
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
  'guide:journeyStep',
  'guide:hook_complete',
  'guide:curriculum_complete',
  'guide:specialize_start',
  'guide:coaching_card',
  'presence:changed',
]
