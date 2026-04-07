/**
 * Socket.io client singleton.
 * Connect lazily — only when a PvP game is started.
 */
import { io } from 'socket.io-client'

// Socket.IO connects to same origin — server.js proxies /socket.io/* to the backend.
// In local dev (Vite), VITE_SOCKET_URL points directly to the backend dev server.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? ''

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
