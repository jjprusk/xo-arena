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
import { setSseSession, onSseSessionChange } from './rtSession.js'

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
//   We keep a single `handler` per event type that fans out to every caller.
//
// We do not track or apply a server-side channel filter. The connection is
// opened once with no `channels=` query param; new callers only register
// listeners and a per-caller channel list used for client-side dispatch.

let _es = null
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

function unionEventTypes() {
  const set = new Set(KNOWN_SSE_EVENT_TYPES)
  for (const c of _callers) for (const t of c.eventTypes) set.add(t)
  return [...set]
}

function openStream() {
  // We deliberately do NOT pass a `channels` filter to the server. The
  // singleton already dispatches per-caller on the client (dispatchToCallers
  // matches each event type against the caller's `channels` prefix list), so
  // server-side filtering is only a bandwidth optimization — and a costly
  // one, because changing it requires reopening the EventSource. A reopen
  // mints a new SSE session id; any POST that fires in the gap before the
  // new `session` frame arrives 409s with SSE_SESSION_EXPIRED. That's what
  // killed "Play vs Bot" on a hard refresh: useGameSDK's table-create POST
  // raced the reopen triggered by its own `table:` channel registration.
  // Opening with no filter means new callers never trigger a reopen.
  const params = new URLSearchParams()
  const lastId = loadLastId()
  if (lastId) params.set('lastEventId', lastId)

  const url = `/api/v1/events/stream${params.toString() ? `?${params}` : ''}`
  console.info('[useEventStream] opening shared SSE:', url)

  const es = new EventSource(url, { withCredentials: true })
  es.onopen  = () => console.info('[useEventStream] SSE open')
  es.onerror = () => console.warn('[useEventStream] SSE error — readyState=' + es.readyState)

  es.addEventListener('session', (e) => {
    // Persist the id attached to the session frame (the server emits the
    // current redis stream tail) so a reopen that happens before any real
    // event arrives still has a Last-Event-ID resume cursor.
    if (e.lastEventId) saveLastId(e.lastEventId)
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
}

function closeStream() {
  if (!_es) return
  detachAllListeners(_es)
  _es.close()
  _es = null
}

function ensureStreamForCallers() {
  if (!_es) {
    if (_callers.size > 0) openStream()
    return
  }
  // The connection has no server-side channel filter (see openStream), so a
  // new caller never requires a reopen — we only need to make sure their
  // named event types have listeners attached.
  for (const t of unionEventTypes()) attachListener(_es, t)
}

function register(record) {
  _callers.add(record)
  ensureStreamForCallers()
  return () => {
    _callers.delete(record)
    if (_callers.size === 0) closeStream()
    // No reopen on unregister — narrower filter is fine; existing stream still
    // delivers a superset of what remaining callers need.
  }
}

/**
 * Force the shared EventSource to reopen. Call this whenever the *server-side
 * identity* of the connection has changed and we need a fresh `/events/stream`
 * GET so the broker re-registers us with the new userId.
 *
 * Concrete trigger: a guest signs in (or signs out, or switches accounts).
 * The pre-existing SSE was registered with the prior identity, so personal
 * channels (`userId: <newId>` events) are silently dropped by the server's
 * filter. Without this hook, `guide:journeyStep` for a freshly-signed-in
 * user never reaches the AppLayout listener and the JourneyCard is stuck.
 *
 * Implemented as a *warm* reopen: we open the new EventSource first, swap
 * over once its `session` frame lands, and only then close the old one.
 * Without warm reopen, a guest disposal is immediate (sseSessions debounce
 * skips the no-userId case) — any rt POST in flight using the cached old
 * sessionId then 409s with SSE_SESSION_EXPIRED. The warm overlap keeps the
 * old SSE session alive on the server for the few ms it takes the new
 * connection's session frame to arrive.
 */
export function reopenSharedStream() {
  if (!_es) return
  if (_callers.size === 0) { closeStream(); return }

  const oldEs = _es
  const oldSessionId = _es && _listeners // sentinel — actual id is in rtSession's cache
  // Stop the OLD ES from firing our handlers. We keep its connection open so
  // the server-side session entry remains valid until the NEW ES takes over.
  detachAllListeners(oldEs)
  // openStream() creates the new ES, attaches listeners to it, and sets
  // `_es = newEs`. Until its `session` frame arrives, the cached
  // `_sseSessionId` (in rtSession) is still the OLD one, so any rt POST
  // that fires during the swap continues to hit a live server session.
  openStream()

  // Subscribe to the next session-id flip; close the old ES once it lands.
  // Hard timeout fallback: if no session frame arrives within 5 s, close
  // the old ES anyway so we don't leak a connection.
  let done = false
  const finish = () => {
    if (done) return
    done = true
    try { unsub() } catch {}
    clearTimeout(timer)
    try { oldEs.close() } catch {}
  }
  const unsub = onSseSessionChange(() => finish())
  const timer = setTimeout(finish, 5000)
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
