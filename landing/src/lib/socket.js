// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? ''

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
