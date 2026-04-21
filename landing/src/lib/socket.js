// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { io } from 'socket.io-client'

// Use `|| undefined` not `?? ''`: io('') builds 'http://' (invalid URL) instead of
// using window.location.host. io(undefined) correctly defaults to the current origin.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || undefined

// WebSocket-only on every environment.
//
// History: we previously used polling-only because the polling→websocket
// *upgrade* negotiation was flaky through both Vite's dev proxy and the
// landing express + http-proxy-middleware chain on Fly. That avoided the
// upgrade race, but polling XHRs get aborted constantly by Safari when the
// tab backgrounds or the network blips — and WebKit logs every aborted XHR
// as a misleading "XMLHttpRequest cannot load … due to access control
// checks" in the console. Each disconnect emits two such errors (original
// poll + close-packet POST that also fails), cluttering the console on
// every page.
//
// WebSocket-only sidesteps XHR entirely: one long-lived connection, no
// aborted polling requests, no Safari log spam. Both proxy layers already
// forward WebSocket correctly (Vite has `ws: true`; landing/server.js has
// `ws: true` + `server.on('upgrade', backendProxy.upgrade)`). If the
// handshake ever fails, socket.io emits `connect_error` and the app has
// no real-time — very visible, easy to catch in QA. Revert to `polling` if
// that happens.
const TRANSPORTS = ['websocket']

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
