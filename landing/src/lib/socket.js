// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { io } from 'socket.io-client'

// Use `|| undefined` not `?? ''`: io('') builds 'http://' (invalid URL) instead of
// using window.location.host. io(undefined) correctly defaults to the current origin.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || undefined

// In development Vite proxies /socket.io → backend, but the HTTP→WebSocket
// upgrade is unreliable through the proxy: Socket.IO fires a rapid
// connect/disconnect cycle that triggers red console errors AND races with
// backend event handlers (the /:id guard bails when the upgrade socket drops).
// Use polling-only in dev so there is one stable connection with no upgrade.
// In production the socket connects directly and WebSocket works fine.
const TRANSPORTS = import.meta.env.DEV ? ['polling'] : ['polling', 'websocket']

let _socket = null

export function getSocket() {
  if (!_socket) {
    _socket = io(SOCKET_URL, { autoConnect: false, transports: TRANSPORTS })
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
// Fix: disconnect cleanly when the tab hides (no in-flight XHR to abort) and
// reconnect immediately when the user returns (beats Socket.IO's 1-5s backoff).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!_socket) return
    if (document.visibilityState === 'hidden') {
      // Disconnect before Safari kills the in-flight XHR — prevents the
      // "access control checks" console error on backgrounded tabs.
      if (_socket.connected) _socket.disconnect()
    } else {
      // Tab is visible again — reconnect immediately.
      if (!_socket.connected) _socket.connect()
    }
  })
}
