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

perfMark('main:module-evaluated')

// Hook window.onerror + unhandledrejection so failures land in the admin Log
// Viewer instead of vanishing into the browser console. Idempotent — safe
// to call once per page lifetime.
installGlobalErrorHandlers()

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
