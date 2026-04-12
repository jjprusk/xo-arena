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

      // Persistent connect handler — re-subscribes after backend restarts
      function onConnect() { subscribe() }
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
      socket.off('connect')
      TOURNAMENT_EVENTS.forEach(channel => {
        socket.removeAllListeners(channel)
      })
    }
  }, [])

  return { lastEvent }
}
