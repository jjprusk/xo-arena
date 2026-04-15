// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { io } from 'socket.io-client'

// Use `|| undefined` not `?? ''`: io('') builds 'http://' (invalid URL) instead of
// using window.location.host. io(undefined) correctly defaults to the current origin.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || undefined

// Polling-only on every environment.
//
// In dev: Vite's proxy fires a rapid connect/disconnect cycle on the
// HTTP→WebSocket upgrade and races with backend event handlers.
//
// In prod: the same upgrade fails through the landing express + http-proxy-
// middleware proxy chain on Fly. The failed upgrade kills the polling
// session server-side, the next poll returns 400, socket.io reconnects,
// tries to upgrade again, fails again — a 3–4s cascade that delays the
// game from appearing.
//
// Polling-only sidesteps the upgrade entirely. Slightly higher per-event
// latency (~50ms vs ~10ms) but a stable connection with no error cascade.
// Revisit if the proxy WebSocket forwarding gets fixed (see Game_System_Audit).
const TRANSPORTS = ['polling']

let _socket = null

export function getSocket() {
  if (!_socket) {
    _socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: TRANSPORTS,
      upgrade: false,           // never attempt polling → websocket upgrade
      rememberUpgrade: false,
    })
    _socket.on('connect_error', () => {})
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
// Strategy: only disconnect on hide in Safari (where the XHR is forcibly killed).
// In other browsers, leaving the socket connected avoids the 400 race condition
// that occurs when disconnect() closes the server session mid in-flight polling GET.
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
