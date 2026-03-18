/**
 * Socket.io client singleton.
 * Connect lazily — only when a PvP game is started.
 */
import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

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
