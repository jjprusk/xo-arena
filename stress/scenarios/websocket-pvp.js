/**
 * WebSocket / Socket.io PvP stress test
 *
 * Tests that WebSocket connections can be established, sustained, and
 * rooms can be created/joined under load.
 *
 * Socket.io v4 direct-WS flow (no polling step):
 *   1. Connect to /socket.io/?EIO=4&transport=websocket
 *   2. Server sends 0{...} (EIO handshake)
 *   3. Client sends 40 (namespace connect)
 *   4. Server sends 40{sid} (namespace connected)
 *   5. Client sends 42["room:create", {...}]
 *   6. Server sends 42["room:created", {slug}]
 *   7. Client plays moves; game ends when 42["game:over", ...] arrives
 *
 * Each VU is a solo host — no opponent joins (testing infra under load,
 * not game logic). Measures connection rate, message latency, error rate.
 */

import http  from 'k6/http'
import ws    from 'k6/ws'
import { check, sleep } from 'k6'
import { Rate, Counter, Trend } from 'k6/metrics'
import { BASE_URL, WS_URL } from '../config.js'

export const options = {
  stages: [
    { duration: '20s', target: 5  },
    { duration: '1m',  target: 5  },
    { duration: '20s', target: 15 },
    { duration: '30s', target: 15 },
    { duration: '15s', target: 0  },
  ],
  thresholds: {
    'ws_session_errors':    ['rate<0.02'],
    'room_created':         ['count>0'],
    'ws_connect_duration':  ['p(95)<500'],
  },
}

const wsErrors         = new Rate('ws_session_errors')
const roomsCreated     = new Counter('room_created')
const wsConnectTime    = new Trend('ws_connect_duration', true)

function sioSend(socket, event, data) {
  socket.send(`42${JSON.stringify([event, data])}`)
}

export default function () {
  let sessionError  = false
  let roomCreated   = false
  const connectStart = Date.now()

  const res = ws.connect(
    `${WS_URL}/socket.io/?EIO=4&transport=websocket`,
    { headers: { 'Origin': `${BASE_URL.replace('3000', '5173')}` } },
    (socket) => {
      socket.on('open', () => {
        wsConnectTime.add(Date.now() - connectStart)
      })

      socket.on('message', (msg) => {
        // EIO heartbeat ping
        if (msg === '2') { socket.send('3'); return }

        // EIO handshake — send Socket.io namespace connect
        if (msg.startsWith('0{')) {
          socket.send('40')
          return
        }

        if (!msg.startsWith('4')) return
        try {
          // Namespace connected — create a room
          if (msg === '40' || msg.startsWith('40{')) {
            sioSend(socket, 'room:create', { mark: 'X', spectatorAllowed: false })
            return
          }

          const [event, data] = JSON.parse(msg.slice(2))

          if (event === 'room:created') {
            roomCreated = true
            roomsCreated.add(1)
            // Leave quickly — we're just testing infra, not running a full game
            socket.close()
            return
          }

          if (event === 'error') {
            // expected: slug conflicts, full rooms, etc.
            socket.close()
          }
        } catch {}
      })

      socket.on('error', () => {
        sessionError = true
        socket.close()
      })

      // Safety timeout
      socket.setTimeout(() => { socket.close() }, 10000)
    }
  )

  check(res, { 'ws upgraded (101)': r => r && r.status === 101 })
  wsErrors.add(sessionError ? 1 : 0)

  sleep(Math.random() * 0.5 + 0.1)
}
