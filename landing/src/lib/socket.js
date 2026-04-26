// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { io } from 'socket.io-client'

// Use `|| undefined` not `?? ''`: io('') builds 'http://' (invalid URL) instead of
// using window.location.host. io(undefined) correctly defaults to the current origin.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || undefined

// WebSocket primary, polling fallback.
//
// History: we previously used polling-only (Vite/Fly upgrade negotiation was
// flaky), then switched to websocket-only (Safari console spam from aborted
// polling XHRs). WS-only worked on Fly but the Vite dev proxy intermittently
// closes the WS handshake under Safari Private — leaving socket.io in an
// infinite reconnect loop with no real-time and no visible UI signal.
//
// Listing both transports keeps WS as the happy path (production + most dev
// sessions) and lets socket.io drop to polling when the WS handshake fails.
// Safari log spam only appears when polling is the active transport, which
// now only happens when WS is genuinely unreachable — i.e. exactly the case
// where falling back is correct.
const TRANSPORTS = ['websocket', 'polling']

let _socket = null

export function getSocket() {
  if (!_socket) {
    _socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: TRANSPORTS,
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

// Reconnect the socket whenever the window/tab becomes visible or regains focus
// and the socket has dropped.
//
// Do NOT proactively disconnect on hide. A prior version disconnected Safari on
// `visibilitychange: hidden` to work around aborted polling XHRs — but we're on
// WebSocket-only now, and a proactive disconnect triggers the server's room
// disconnect timer, which misfires on brief macOS Space switches / app-switches
// and was the root cause of "Room not found" timeouts after short away periods.
//
// Also listen to `window.focus`: macOS Space switches DON'T fire visibilitychange
// (the tab stays "visible" per spec, the window is just on another Space), so
// focus is the only reliable signal that the user has returned.
if (typeof window !== 'undefined') {
  function reconnectIfDropped() {
    if (_socket && !_socket.connected) _socket.connect()
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconnectIfDropped()
  })
  window.addEventListener('focus', reconnectIfDropped)
}
