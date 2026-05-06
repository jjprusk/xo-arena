// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * The "full app" bootstrap. Only loaded on browsers that pass the
 * checkBrowserSupport gate in main.jsx. Importing this unconditionally
 * from an unsupported engine would trigger a stylesheet parse failure
 * and the unstyled-page flash we're trying to avoid.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { getToken } from './lib/getToken.js'
import { perfMark } from './lib/perfLog.js'
import { installGlobalErrorHandlers } from './lib/frontendLogger.js'
import { startRUM } from './lib/rum.js'

perfMark('main:module-evaluated')

// Hook window.onerror + unhandledrejection so failures land in the admin Log
// Viewer instead of vanishing into the browser console. Idempotent — safe
// to call once per page lifetime.
installGlobalErrorHandlers()

// Start Real-User Monitoring (web-vitals → /api/v1/perf/vitals beacon).
// Idempotent; respects VITE_RUM_SAMPLE_RATE (default 1.0); silent if
// listeners can't be attached.
startRUM()

// Phase 20.2 — eager Service Worker registration for app-shell caching.
// Idempotent: pushSubscribe.js also registers /sw.js lazily on push
// opt-in; same URL means the second register() is a no-op. Wrapped in
// try/catch + delayed past first paint so an SSL hiccup or unsupported
// browser never breaks the boot sequence. Kill switch (`sw.enabled`
// SystemConfig key) is consulted by the SW itself on `activate`.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  // Defer one rAF + one idle tick so registration doesn't compete with
  // the initial paint / hydration on slow devices.
  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* fail silently */ })
  }
  if ('requestIdleCallback' in window) {
    requestIdleCallback(register, { timeout: 4000 })
  } else {
    setTimeout(register, 1000)
  }
}

// Pre-fetch token in parallel with React rendering when session cache shows a signed-in user.
// Eliminates the sequential /api/token → /api/<page-data> waterfall on hard reload.
const _sc = (() => { try { return JSON.parse(localStorage.getItem('aiarena_session_cache')) } catch { return null } })()
if (_sc?.user) getToken().catch(() => {})

perfMark('main:before-render')
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
