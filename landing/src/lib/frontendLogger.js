// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Frontend log shipper — feeds the admin Log Viewer.
 *
 * Why this exists: the `logs` table powering /admin/logs has no producer.
 * Backend pino writes to stdout (deferred Future_Ideas: Backend Logs in Admin
 * Log Viewer), and the legacy frontend logger was deleted with the Phase-3.0
 * `frontend/` cleanup and never ported to `landing/`. Result: the viewer has
 * always rendered the empty state.
 *
 * Behaviour:
 *   - DEBUG / INFO / WARN are queued and flushed every 5 s.
 *   - ERROR / FATAL flush immediately (best-effort fire-and-forget).
 *   - Network failures park entries on a retry queue, drained on the next
 *     batch tick. Bounded so a long offline window can't grow without limit.
 *   - `setLogUserId(id)` patches a closure so subsequent entries carry it.
 *     The legacy `Object.assign(sessionId, { userId })` was a no-op on the
 *     stringly-typed sessionId; that's the bug the Future_Ideas entry called
 *     out and the reason userId was always null.
 *   - `installGlobalErrorHandlers()` hooks `window.onerror` +
 *     `unhandledrejection` so uncaught failures hit the table without the
 *     caller having to wrap every async path.
 *
 * Public endpoint, no auth required (POST /api/v1/logs accepts anonymous
 * frontend traffic by design — see `backend/src/routes/logs.js`).
 */

const BATCH_INTERVAL_MS    = 5_000
const RETRY_QUEUE_MAX      = 500    // hard cap — drop oldest if exceeded
const VALID_LEVELS         = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'])
const isDev                = (typeof import.meta !== 'undefined' && import.meta.env?.DEV) ?? false
const API_BASE             = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ?? ''

let _userId    = null
let _sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `flog_${Math.random().toString(36).slice(2)}`
let _queue     = []
let _retry     = []
let _timer     = null

function postEntries(entries) {
  return fetch(`${API_BASE}/api/v1/logs`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ entries }),
    keepalive: true,    // survives pagehide / unload
  })
}

async function flushNow() {
  const merged = [..._retry, ..._queue]
  _retry = []
  _queue = []
  if (merged.length === 0) return
  try {
    const res = await postEntries(merged)
    if (!res.ok && res.status >= 500) throw new Error(`logs POST ${res.status}`)
  } catch {
    // Park for next tick. Drop oldest if cap exceeded — keeping the most
    // recent failures has more diagnostic value than ancient ones.
    const combined = [..._retry, ...merged]
    _retry = combined.length > RETRY_QUEUE_MAX
      ? combined.slice(combined.length - RETRY_QUEUE_MAX)
      : combined
  }
}

function ensureTimer() {
  if (_timer) return
  _timer = setInterval(flushNow, BATCH_INTERVAL_MS)
}

function makeEntry(level, message, meta) {
  return {
    timestamp: new Date().toISOString(),
    level,
    source:    'frontend',
    message:   String(message ?? ''),
    userId:    _userId,
    sessionId: _sessionId,
    roomId:    null,
    meta:      meta ?? null,
  }
}

function log(level, message, meta) {
  if (!VALID_LEVELS.has(level)) level = 'INFO'
  const entry = makeEntry(level, message, meta)

  if (isDev) {
    const fn = ({ DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error', FATAL: 'error' })[level]
    // eslint-disable-next-line no-console
    console[fn]?.(`[${level}] ${message}`, meta ?? '')
  }

  if (level === 'ERROR' || level === 'FATAL') {
    // Immediate flush for high-severity entries: ride alongside any queued
    // batch + retries so a single fetch carries everything pending.
    const batch = [..._retry, ..._queue, entry]
    _retry = []
    _queue = []
    postEntries(batch).catch(() => { _retry = batch.slice(-RETRY_QUEUE_MAX) })
    return
  }

  _queue.push(entry)
  ensureTimer()
}

export function setLogUserId(userId) {
  _userId = userId || null
}

/** Reset for tests — drops queues + clears the batch timer. */
export function _resetForTests() {
  if (_timer) { clearInterval(_timer); _timer = null }
  _userId    = null
  _sessionId = 'test-session'
  _queue     = []
  _retry     = []
}

export const flogger = {
  debug: (m, x) => log('DEBUG', m, x),
  info:  (m, x) => log('INFO',  m, x),
  warn:  (m, x) => log('WARN',  m, x),
  error: (m, x) => log('ERROR', m, x),
  fatal: (m, x) => log('FATAL', m, x),
}

let _globalsInstalled = false

export function installGlobalErrorHandlers() {
  if (_globalsInstalled || typeof window === 'undefined') return
  _globalsInstalled = true

  window.addEventListener('error', (event) => {
    const msg = event?.message ?? 'window.onerror'
    flogger.error(msg, {
      filename: event.filename ?? null,
      lineno:   event.lineno   ?? null,
      colno:    event.colno    ?? null,
      stack:    event.error?.stack ?? null,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const msg    = reason?.message ?? String(reason ?? 'unhandledrejection')
    flogger.error(msg, { stack: reason?.stack ?? null, kind: 'unhandledrejection' })
  })

  // Best-effort flush on tab close. fetch{keepalive:true} survives the
  // unload long enough to deliver in most browsers.
  window.addEventListener('pagehide', () => { flushNow() })
}

// Test hooks
export const _internal = {
  flushNow,
  getQueue: () => [..._queue],
  getRetry: () => [..._retry],
}
