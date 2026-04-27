// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { io } from 'socket.io-client'

// Use `|| undefined` not `?? ''`: io('') builds 'http://' (invalid URL) instead of
// using window.location.host. io(undefined) correctly defaults to the current origin.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || undefined

// Dev: polling-only. Prod: polling primary, WS upgrade.
//
// The Vite dev proxy + Safari (esp. Private) cannot reliably upgrade
// polling → WebSocket: the upgrade fails with "network connection was
// lost", and the failed upgrade *invalidates the polling session on the
// backend* — subsequent polling requests then 400, and the page hangs
// with no working transport. Skipping the upgrade in dev avoids this
// entirely; localhost latency makes polling indistinguishable from WS.
// In prod (Fly) the WS upgrade works, so we keep both transports.
const TRANSPORTS = import.meta.env.DEV
  ? ['polling']
  : ['polling', 'websocket']

let _socket = null

export function getSocket() {
  if (!_socket) {
    _socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: TRANSPORTS,
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
