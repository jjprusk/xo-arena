// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * RUM (Real-User Monitoring) — Web Vitals beacon.
 *
 * On app boot, registers `onFCP / onLCP / onINP / onCLS / onTTFB`
 * listeners from web-vitals. Each metric pushes onto a per-tab queue.
 * On `pagehide` (works on iOS Safari unlike `unload`) and on the next
 * visibility-hidden, the queue is drained as a single beacon to
 * `/api/v1/perf/vitals` via `navigator.sendBeacon`. The endpoint is
 * authless and best-effort (always 204).
 *
 * Sampling: VITE_RUM_SAMPLE_RATE in [0,1]. Default 1.0 (collect every
 * session). Decision is sticky for the tab — if we don't sample,
 * we don't even register the listeners.
 *
 * Privacy: never sends a userId. The only identifier is `sessionId`,
 * a per-tab random hex string minted via `crypto.getRandomValues`.
 *
 * Companion to doc/Performance_Plan_v2.md §D0.
 */
import { onFCP, onLCP, onINP, onCLS, onTTFB } from 'web-vitals'

const ENDPOINT     = '/api/v1/perf/vitals'
const SAMPLE_RATE  = (() => {
  const raw = import.meta.env.VITE_RUM_SAMPLE_RATE
  const n = raw == null ? 1.0 : parseFloat(raw)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1.0
})()

let _started = false
let _sampled = false
const _queue = []

function deviceClass() {
  try {
    return window.innerWidth < 640 ? 'mobile' : 'desktop'
  } catch { return 'unknown' }
}

function effectiveType() {
  try { return navigator.connection?.effectiveType ?? 'unknown' } catch { return 'unknown' }
}

function sessionId() {
  if (window.__rumSessionId) return window.__rumSessionId
  let id = 'sess_'
  try {
    const buf = new Uint8Array(8)
    crypto.getRandomValues(buf)
    id += [...buf].map(b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    id += Math.random().toString(16).slice(2, 18)
  }
  window.__rumSessionId = id
  return id
}

function record(metric) {
  // Round numeric values to 2 decimal places to keep the wire payload tight.
  // CLS is unitless (0..N); the others are ms.
  const value = Math.round(metric.value * 100) / 100
  _queue.push({
    name:           metric.name,
    value,
    rating:         metric.rating ?? null,
    id:             metric.id,
    navigationType: metric.navigationType ?? null,
    route:          (typeof location !== 'undefined' && location.pathname) || '/',
  })
}

function flush() {
  if (!_queue.length) return
  const body = JSON.stringify({
    sessionId:      sessionId(),
    deviceClass:    deviceClass(),
    effectiveType:  effectiveType(),
    releaseVersion: import.meta.env.VITE_APP_VERSION ?? null,
    userAgent:      (navigator.userAgent || '').slice(0, 200),
    vitals:         _queue.splice(0),
  })
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      // Wrap in a Blob with explicit JSON type — sendBeacon's default is
      // `text/plain`, which Express's `express.json()` middleware skips,
      // and the route would silently 204 with an empty body.
      const blob = new Blob([body], { type: 'application/json' })
      navigator.sendBeacon(ENDPOINT, blob)
      return
    }
  } catch {}
  try {
    fetch(ENDPOINT, {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {}
}

/**
 * Initialize the RUM listeners. Idempotent. Safe to call from
 * `main.supported.jsx` at boot — wraps everything in try/catch so a
 * misbehaving observer never crashes the app.
 */
export function startRUM() {
  if (_started) return
  _started = true
  try {
    if (Math.random() >= SAMPLE_RATE) return
    _sampled = true
    onFCP (record)
    onLCP (record)
    onINP (record)
    onCLS (record)
    onTTFB(record)
    // pagehide is the modern, reliable lifecycle event for "user is leaving".
    window.addEventListener('pagehide', flush, { capture: true })
    // Backstop: visibility → hidden also drains, so SPA-internal navs that
    // background the tab between FCP/LCP and pagehide still report.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
  } catch {
    // Don't surface — RUM must never break the app.
  }
}

// Test hooks — exported so unit tests can poke at internal state without
// leaking it into production callsites.
export const __rum_internals = {
  isStarted: () => _started,
  isSampled: () => _sampled,
  queueSize: () => _queue.length,
  drain:     flush,
}
