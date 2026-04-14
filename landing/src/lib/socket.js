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
