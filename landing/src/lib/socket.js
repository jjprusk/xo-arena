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
