// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Socket.io client singleton.
 * Connect lazily — only when a PvP game is started.
 */
import { io } from 'socket.io-client'

// Socket.IO connects to same origin — server.js proxies /socket.io/* to the backend.
// In local dev (Vite), VITE_SOCKET_URL points directly to the backend dev server.
// Use `|| undefined` not `?? ''`: io('') builds 'http://' (invalid URL) instead of
// using window.location.host. io(undefined) correctly defaults to the current origin.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || undefined

let _socket = null

export function getSocket() {
  if (!_socket) {
    _socket = io(SOCKET_URL, { autoConnect: false })
  }
  return _socket
}

export function connectSocket(token = null) {
  const s = getSocket()
  if (token) s.auth = { token }
  if (!s.connected) s.connect()
  return s
}

export function disconnectSocket() {
  if (_socket?.connected) _socket.disconnect()
}

// Reconnect immediately when the user returns to a suspended tab.
// Safari (and iOS) freeze JS and kill network connections when a tab is
// backgrounded — Socket.IO's built-in reconnect backoff can take 1-5s.
// This fires as soon as the tab becomes visible again, beating the backoff.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && _socket && !_socket.connected) {
      _socket.connect()
    }
  })
}

/**
 * Log current listener counts per event to the console.
 * Only active when VITE_DEBUG_SOCKET=true — no-op in production.
 */
export function logSocketListeners() {
  if (import.meta.env.VITE_DEBUG_SOCKET !== 'true') return
  const s = getSocket()
  const events = ['accomplishment', 'feedback:new', 'connect', 'disconnect',
    'pvp:move', 'pvp:start', 'pvp:end', 'room:created', 'room:joined']
  console.table(Object.fromEntries(events.map(e => [e, s.listeners(e).length])))
}
