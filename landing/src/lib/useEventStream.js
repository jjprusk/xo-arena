// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * useEventStream — Tier 2 SSE client.
 *
 * One shared EventSource per tab. Multiple useEventStream callers
 * (AppLayout, TableDetailPage, useGameSDK, gym tabs, …) all attach
 * handlers to the same connection rather than opening their own
 * stream. Without this, the per-user 8-connection cap on the server
 * (and React StrictMode's double-invoke in dev) reliably blew past the
 * limit and 429-storms killed gameplay.
 *
 * Channel filter is the union of every caller's prefix list. When a
 * caller's prefix is not already covered, the shared connection is
 * reopened with the wider filter; otherwise the existing connection
 * is reused. Last-Event-ID is persisted in sessionStorage so the
 * reopened stream replays missed events.
 *
 * Usage:
 *   useEventStream({
 *     channels: ['tournament:', 'guide:'],
 *     onEvent:  (channel, payload, id) => { ... },
 *     enabled:  someCondition,
 *   })
 */
import { useEffect, useRef } from 'react'
import { setSseSession } from './rtSession.js'

const STORAGE_KEY = 'aiarena_tier2_last_event_id'

function loadLastId() {
  try { return sessionStorage.getItem(STORAGE_KEY) || null } catch { return null }
}
function saveLastId(id) {
  try { sessionStorage.setItem(STORAGE_KEY, id) } catch {}
}

// ── Singleton connection ─────────────────────────────────────────────────────
//
// `_es`        — current EventSource (null when no callers are mounted)
// `_callers`   — Set of registered caller records: { channels, eventTypes, handler }
// `_listeners` — Map<eventType, fn> of currently-attached EventSource listeners.
//   We keep a single `handle` per event type that fans out to every caller.
// `_currentChannels` — sorted, deduped union of every caller's channels; used to
//   decide whether a reopen is needed when a new caller arrives.

let _es = null
let _currentChannels = []
const _callers = new Set()
const _listeners = new Map()

function dispatchToCallers(eventType, payload, eventId) {
  for (const c of _callers) {
    if (c.channels.length === 0) {
      c.handler?.(eventType, payload, eventId)
      continue
    }
    if (c.channels.some(p => eventType === p || eventType.startsWith(p))) {
      c.handler?.(eventType, payload, eventId)
    }
  }
}

function makeHandler(eventType) {
  return (e) => {
    saveLastId(e.lastEventId || '')
    let payload = {}
    try { payload = e.data ? JSON.parse(e.data) : {} } catch {}
    dispatchToCallers(eventType, payload, e.lastEventId)
  }
}

function attachListener(es, eventType) {
  if (_listeners.has(eventType)) return
  const fn = makeHandler(eventType)
  _listeners.set(eventType, fn)
  es.addEventListener(eventType, fn)
}

function detachAllListeners(es) {
  for (const [eventType, fn] of _listeners) {
    es.removeEventListener(eventType, fn)
  }
  _listeners.clear()
}

function unionChannels() {
  const set = new Set()
  for (const c of _callers) for (const p of c.channels) set.add(p)
  return [...set].sort()
}

function unionEventTypes() {
  const set = new Set(KNOWN_SSE_EVENT_TYPES)
  for (const c of _callers) for (const t of c.eventTypes) set.add(t)
  return [...set]
}

function openStream() {
  const channels = unionChannels()
  const params = new URLSearchParams()
  if (channels.length) params.set('channels', channels.join(','))
  const lastId = loadLastId()
  if (lastId) params.set('lastEventId', lastId)

  const url = `/api/v1/events/stream${params.toString() ? `?${params}` : ''}`
  console.info('[useEventStream] opening shared SSE:', url)

  const es = new EventSource(url, { withCredentials: true })
  es.onopen  = () => console.info('[useEventStream] SSE open')
  es.onerror = () => console.warn('[useEventStream] SSE error — readyState=' + es.readyState)

  es.addEventListener('session', (e) => {
    try {
      const { sseSessionId } = JSON.parse(e.data || '{}')
      if (sseSessionId) setSseSession(sseSessionId)
    } catch {}
  })

  // onmessage covers any unnamed events (rare).
  es.onmessage = (e) => {
    saveLastId(e.lastEventId || '')
    let payload = {}
    try { payload = e.data ? JSON.parse(e.data) : {} } catch {}
    dispatchToCallers('message', payload, e.lastEventId)
  }

  for (const t of unionEventTypes()) attachListener(es, t)

  _es = es
  _currentChannels = channels
}

function closeStream() {
  if (!_es) return
  detachAllListeners(_es)
  _es.close()
  _es = null
  _currentChannels = []
}

function reopenIfFilterWidened() {
  const next = unionChannels()
  if (!_es) {
    if (_callers.size > 0) openStream()
    return
  }
  // If the next filter is the same as current, reuse.
  if (next.length === _currentChannels.length && next.every((p, i) => p === _currentChannels[i])) {
    // Channels unchanged — but ensure named-event listeners are up to date.
    for (const t of unionEventTypes()) attachListener(_es, t)
    return
  }
  // Channels changed — must reopen with wider filter so new callers receive
  // their topics. The session id may turn over; rtFetch handles that.
  closeStream()
  openStream()
}

function register(record) {
  _callers.add(record)
  reopenIfFilterWidened()
  return () => {
    _callers.delete(record)
    if (_callers.size === 0) closeStream()
    // No reopen on unregister — narrower filter is fine; existing stream still
    // delivers a superset of what remaining callers need.
  }
}

/**
 * Subscribe to the shared SSE stream.
 *
 * Options:
 *   channels — server-side prefix filter contributed by this caller. The
 *     shared connection's filter is the union of every caller's channels.
 *   eventTypes — extra named event types this caller wants registered as
 *     EventSource listeners (in addition to KNOWN_SSE_EVENT_TYPES).
 *   onEvent(channel, payload, eventId) — called once per delivered event
 *     whose type matches one of this caller's `channels` prefixes (or any
 *     event when `channels` is empty).
 *   enabled — defer registering until truthy.
 */
export function useEventStream({ channels = [], eventTypes = [], onEvent, enabled = true } = {}) {
  const handlerRef = useRef(onEvent)
  useEffect(() => { handlerRef.current = onEvent }, [onEvent])

  const channelsKey   = channels.join(',')
  const eventTypesKey = eventTypes.join(',')

  useEffect(() => {
    if (!enabled) return
    if (typeof EventSource === 'undefined') {
      console.warn('[useEventStream] EventSource not available in this browser')
      return
    }
    const record = {
      channels:   [...channels],
      eventTypes: [...eventTypes],
      handler:    (channel, payload, id) => handlerRef.current?.(channel, payload, id),
    }
    return register(record)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, channelsKey, eventTypesKey])
}

// Re-exported so other modules can extend the static listener set without
// modifying useEventStream itself.
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
