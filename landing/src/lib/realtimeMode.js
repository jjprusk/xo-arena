// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * realtimeMode — client-side cache of /api/v1/realtime/mode.
 *
 * The server publishes a JSON document like:
 *
 *   {
 *     transport:  'socketio' | 'dual' | 'sse',
 *     perFeature: { idle: 'sse' | 'socketio' | null, … },
 *   }
 *
 * Client code calls `viaSse(feature)` to ask "should I use the SSE+POST
 * path for this feature on this transport?" — true when `perFeature[feature]`
 * is `'sse'`, OR when `perFeature[feature]` is unset and the global
 * transport is `'sse'`. Anything else (default `'socketio'`, explicit
 * `'socketio'`, or `'dual'` without an SSE per-feature override) returns
 * false so the legacy socket path is used.
 *
 * One in-flight fetch is dedup'd; the result is cached until the page is
 * reloaded. Toggling SystemConfig requires a refresh on the client to take
 * effect — same as the existing guide flag.
 */

const BASE = import.meta.env.VITE_API_URL ?? ''

let _cached   = null
let _inflight = null

async function fetchMode() {
  try {
    const res = await fetch(`${BASE}/api/v1/realtime/mode`, { credentials: 'include' })
    if (!res.ok) throw new Error(`mode fetch ${res.status}`)
    return await res.json()
  } catch {
    // Fail closed to socketio so a transient backend hiccup doesn't accidentally
    // route the client onto the SSE+POST path before it's globally enabled.
    return { transport: 'socketio', perFeature: {} }
  }
}

export async function loadRealtimeMode() {
  if (_cached) return _cached
  if (_inflight) return _inflight
  _inflight = fetchMode().then(m => { _cached = m; _inflight = null; return m })
  return _inflight
}

/**
 * Synchronous accessor — returns null if loadRealtimeMode() has not yet
 * resolved. Callers that can't `await` (event handlers, focus listeners)
 * should call loadRealtimeMode() once at boot and then use this.
 */
export function getRealtimeMode() { return _cached }

export function viaSse(feature) {
  const m = _cached
  if (!m) return false
  const per = m.perFeature?.[feature]
  if (per === 'sse') return true
  if (per === 'socketio') return false
  return m.transport === 'sse'
}

// Test hook — not used in prod.
export function _resetForTests() { _cached = null; _inflight = null }
