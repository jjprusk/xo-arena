import { useState, useEffect } from 'react'
import { connectSocket } from '../lib/socket.js'
import { getToken } from '../lib/getToken.js'

const TOURNAMENT_EVENTS = [
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
 * Listens for all 5 tournament events and stores the most recent one.
 *
 * Returns: { lastEvent } — the most recent tournament event received,
 * shaped as { channel, data, ts } or null if none received yet.
 */
export function useTournamentSocket() {
  const [lastEvent, setLastEvent] = useState(null)

  useEffect(() => {
    let socket = null
    let subscribed = false

    async function setup() {
      const token = await getToken()
      if (!token) return

      socket = connectSocket(token)

      function subscribe() {
        if (subscribed) return
        subscribed = true
        socket.emit('user:subscribe', { authToken: token })
      }

      // If already connected, subscribe immediately
      if (socket.connected) {
        subscribe()
      } else {
        socket.once('connect', subscribe)
      }

      // Register listeners for all tournament channels
      TOURNAMENT_EVENTS.forEach(channel => {
        socket.on(channel, (data) => {
          setLastEvent({ channel, data, ts: Date.now() })
        })
      })
    }

    setup()

    return () => {
      if (!socket) return
      socket.off('connect')
      TOURNAMENT_EVENTS.forEach(channel => {
        socket.removeAllListeners(channel)
      })
    }
  }, [])

  return { lastEvent }
}
