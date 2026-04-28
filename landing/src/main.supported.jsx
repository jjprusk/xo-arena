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
import { configurePvp } from '@xo-arena/xo'
import { connectSocket, disconnectSocket, getSocket } from './lib/socket.js'
import { getToken } from './lib/getToken.js'
import { loadRealtimeMode } from './lib/realtimeMode.js'
import { useSoundStore } from './store/soundStore.js'
import { perfMark } from './lib/perfLog.js'

perfMark('main:module-evaluated')

// Pre-fetch token in parallel with React rendering when session cache shows a signed-in user.
// Eliminates the sequential /api/token → /api/<page-data> waterfall on hard reload.
const _sc = (() => { try { return JSON.parse(localStorage.getItem('aiarena_session_cache')) } catch { return null } })()
if (_sc?.user) getToken().catch(() => {})

// Kick off the realtime-mode probe in parallel with the first React render
// so per-feature flags (idle, guide, …) are available by the time hooks run.
// Fire-and-forget — the helper caches the result and falls back to socketio
// on any failure.
loadRealtimeMode().catch(() => {})

// Wire socket, token, and sound into the shared PvP store
configurePvp({
  connectSocket,
  disconnectSocket,
  getSocket,
  getToken,
  playSound: (key) => useSoundStore.getState().play(key),
})

perfMark('main:before-render')
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
