// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * rtSession — client-side handle for the active SSE session.
 *
 * The server mints a `sseSessionId` for every `/api/v1/events/stream`
 * connection and pushes it as the first SSE frame (event:'session', data:
 * {sseSessionId}). The useEventStream hook calls setSseSession() when it
 * sees that frame; rtFetch() reads it via getSseSession() and attaches
 * `X-SSE-Session` to every realtime POST.
 *
 * If the server returns 409 (sse-session-required), we drop the cached id
 * and let the caller decide whether to retry — typically the EventSource
 * will auto-reconnect within ~2s and the next call will succeed.
 *
 * This file is intentionally tiny — the hard work (auth, retries, error
 * shapes) lives in the existing api.js. rtFetch is the realtime-specific
 * complement, not a replacement.
 */
import { getToken } from './getToken.js'

let _sseSessionId = null
const _listeners = new Set()

export function getSseSession() { return _sseSessionId }

export function setSseSession(id) {
  if (_sseSessionId === id) return
  _sseSessionId = id || null
  for (const fn of _listeners) {
    try { fn(_sseSessionId) } catch {}
  }
}

export function clearSseSession() { setSseSession(null) }

/** Subscribe to changes; useful for components that should defer rt
 *  POSTs until the session is up. Returns an unsubscribe fn. */
export function onSseSessionChange(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

const BASE = import.meta.env.VITE_API_URL ?? ''

/**
 * Fetch wrapper for `/api/v1/rt/*` POSTs.
 *
 *   await rtFetch('/rt/tables/abc/idle/pong', { method: 'POST' })
 *
 * Behavior:
 *   - Adds `X-SSE-Session` from the in-memory holder.
 *   - Adds Bearer token from getToken().
 *   - JSON-encodes body if present.
 *   - On 409 (sse-session-required) the cached id is cleared. Caller can
 *     retry once the EventSource reconnects (which happens automatically
 *     in ~2s).
 *   - Throws an Error on non-2xx with .status and .code populated.
 *
 * Path may start with `/rt/...` (we'll prepend `/api/v1`) or with a leading
 * `/api/...` for internal callers that want the full path explicit.
 */
/**
 * Wait up to `timeoutMs` for the in-memory SSE session id to change to a
 * value different from `prevId`. Resolves with the new id, or `null` on
 * timeout. Used by `rtFetch` to absorb the small window after an
 * EventSource reopen during which the cache still holds the prior id.
 */
function waitForFreshSession(prevId, timeoutMs = 1500) {
  if (_sseSessionId && _sseSessionId !== prevId) return Promise.resolve(_sseSessionId)
  return new Promise((resolve) => {
    let done = false
    const finish = (val) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { unsub() } catch {}
      resolve(val)
    }
    const unsub = onSseSessionChange((id) => {
      if (id && id !== prevId) finish(id)
    })
    const timer = setTimeout(() => finish(null), timeoutMs)
  })
}

export async function rtFetch(path, { method = 'POST', body, headers: extraHeaders, sessionId: sessionIdOverride, _retried = false } = {}) {
  const token = await getToken().catch(() => null)
  // Override beats cache. Used when a feature must pin a specific SSE session
  // id across multiple POSTs (e.g. pong: the server keys players by the
  // sessionId that did the join, so all subsequent inputs from that game must
  // attach the same id — even if a later EventSource opened and overwrote
  // the module-level cache).
  const sessionId = sessionIdOverride ?? _sseSessionId
  const headers = {
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(token     ? { Authorization: `Bearer ${token}` }            : {}),
    ...(sessionId ? { 'X-SSE-Session': sessionId }                  : {}),
    ...(extraHeaders || {}),
  }
  const url = path.startsWith('/api/') ? `${BASE}${path}` : `${BASE}/api/v1${path}`
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }))
    // SSE-session race: a fresh EventSource was just opened (e.g. sign-in
    // triggered reopenSharedStream) and our cached id is the prior, now-
    // disposed one. Wait briefly for the new `session` frame to land and
    // retry exactly once. This absorbs the tens-of-ms window between
    // closeStream() and the new connection's session event.
    if (
      !_retried
      && !sessionIdOverride
      && res.status === 409
      && (errBody?.code === 'SSE_SESSION_EXPIRED' || errBody?.code === 'SSE_SESSION_MISSING')
    ) {
      const fresh = await waitForFreshSession(sessionId)
      if (fresh) {
        return rtFetch(path, { method, body, headers: extraHeaders, _retried: true })
      }
    }
    const err = new Error(errBody?.error || 'Realtime request failed')
    err.status = res.status
    err.code   = errBody?.code ?? null
    throw err
  }
  if (res.status === 204) return null
  return res.json().catch(() => null)
}
