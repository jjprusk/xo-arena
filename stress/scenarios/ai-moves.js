/**
 * AI Move stress test
 *
 * Simulates concurrent players requesting AI moves across all difficulties
 * and implementations. This is the hottest read path in the app.
 *
 * Stages:
 *   0→20 VUs over 30s  — warm-up
 *   20 VUs for 1m      — sustained load
 *   20→50 VUs over 30s — spike
 *   50 VUs for 30s     — peak hold
 *   50→0 VUs over 15s  — ramp-down
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend, Rate } from 'k6/metrics'
import { BASE_URL, headers } from '../config.js'

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m',  target: 20 },
    { duration: '30s', target: 50 },
    { duration: '30s', target: 50 },
    { duration: '15s', target: 0  },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed:   ['rate<0.01'],
  },
}

const moveDuration = new Trend('ai_move_duration', true)
const errorRate    = new Rate('ai_move_errors')

// Board states: empty, mid-game, near-terminal
const BOARDS = [
  [null,null,null, null,null,null, null,null,null],
  ['X', null,null, null,'O', null, null,null,'X' ],
  ['X', 'O', 'X', null,'O', null, null,null,null],
  ['X', 'O', null, 'X','O', null, null,null,null],  // O can win at [6]
]

const IMPLS = [
  { implementation: 'minimax', difficulty: 'master'       },
  { implementation: 'minimax', difficulty: 'advanced'     },
  { implementation: 'minimax', difficulty: 'intermediate' },
  { implementation: 'minimax', difficulty: 'novice'       },
]

export default function () {
  const board = BOARDS[Math.floor(Math.random() * BOARDS.length)]
  const impl  = IMPLS[Math.floor(Math.random() * IMPLS.length)]

  const payload = JSON.stringify({
    board,
    player: Math.random() < 0.5 ? 'X' : 'O',
    ...impl,
  })

  const res = http.post(`${BASE_URL}/api/v1/ai/move`, payload, { headers })

  const ok = check(res, {
    'status 200':      r => r.status === 200,
    'has move field':  r => {
      try { return typeof JSON.parse(r.body).move === 'number' } catch { return false }
    },
  })

  moveDuration.add(res.timings.duration)
  errorRate.add(!ok)

  sleep(Math.random() * 0.5 + 0.1)  // 0.1–0.6s think time
}
