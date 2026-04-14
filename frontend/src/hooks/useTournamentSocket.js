// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { useState, useEffect } from 'react'
import { connectSocket } from '../lib/socket.js'
import { getToken } from '../lib/getToken.js'

const TOURNAMENT_EVENTS = [
  'tournament:round:started',
  'tournament:match:ready',
  'tournament:match:result',
  'tournament:warning',
  'tournament:completed',
  'tournament:cancelled',
]

/**
 * Subscribe to tournament Socket.io events for the current user.
 * Call this once in a top-level component (e.g. AppLayout or TournamentsPage).
 *
 * Emits `user:subscribe` with { authToken } to the socket after connection.
 * Listens for all 6 tournament events and stores the most recent one.
 *
 * Returns: { lastEvent } — the most recent tournament event received,
 * shaped as { channel, data, ts } or null if none received yet.
 */
export function useTournamentSocket() {
  const [lastEvent, setLastEvent] = useState(null)

  useEffect(() => {
    let socket = null
    let subscribed = false
    let onConnect = null   // kept in outer scope so cleanup can remove it precisely

    async function setup() {
      const token = await getToken()
      if (!token) return

      socket = connectSocket(token)

      function subscribe() {
        if (subscribed) return
        subscribed = true
        socket.emit('user:subscribe', { authToken: token })
      }

      // Persistent connect handler — re-subscribes after backend restarts.
      // Assigned to outer-scope `onConnect` so cleanup removes only this handler,
      // not all connect listeners (which would strip AppLayout's presence handler).
      onConnect = () => subscribe()
      socket.on('connect', onConnect)
      if (socket.connected) subscribe()

      TOURNAMENT_EVENTS.forEach(channel => {
        socket.on(channel, (data) => {
          setLastEvent({ channel, data, ts: Date.now() })
        })
      })
    }

    setup()

    return () => {
      if (!socket) return
      // Remove only this hook's connect handler — do NOT use socket.off('connect')
      // without a reference, which would strip all connect listeners (e.g. AppLayout).
      if (onConnect) socket.off('connect', onConnect)
      TOURNAMENT_EVENTS.forEach(channel => socket.off(channel))
    }
  }, [])

  return { lastEvent }
}
