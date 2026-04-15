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
    // Polling-only on every environment.
    //
    // The HTTP→WebSocket upgrade fails through both the Vite dev proxy and the
    // production landing/express + http-proxy-middleware proxy chain on Fly.
    // The failed upgrade kills the polling session server-side, the next poll
    // returns 400, socket.io reconnects, tries upgrade again, fails again — a
    // 3–4s cascade that delays game start.
    //
    // Polling-only sidesteps the upgrade entirely. Slightly higher per-event
    // latency (~50ms vs ~10ms) but a stable connection with no error cascade.
    _socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: ['polling'],
      upgrade: false,
      rememberUpgrade: false,
    })
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

// Handle tab suspension gracefully.
//
// Safari (and iOS) freeze JS and then kill network connections when a tab is
// backgrounded. Any in-flight polling XHR is aborted, which Safari reports as
// "XMLHttpRequest cannot load … due to access control checks" — a misleading
// error that actually means "connection killed by the browser".
//
// Strategy: only disconnect on hide in Safari. In Chrome/Firefox, disconnecting
// while a poll is in flight causes the server to close the session — when the
// in-flight GET returns it gets a 400 response.
const isSafari = typeof navigator !== 'undefined' &&
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent)

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!_socket) return
    if (document.visibilityState === 'hidden') {
      if (isSafari && _socket.connected) _socket.disconnect()
    } else {
      if (!_socket.connected) _socket.connect()
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
