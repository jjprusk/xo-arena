/**
 * Public read endpoints stress test
 *
 * Hits leaderboard, puzzle batch, room list, and AI implementations list —
 * all unauthenticated. These should be the fastest paths and are good
 * baseline health indicators.
 */

import http from 'k6/http'
import { check, group, sleep } from 'k6'
import { Trend, Rate } from 'k6/metrics'
import { BASE_URL, headers } from '../config.js'

export const options = {
  stages: [
    { duration: '20s', target: 30 },
    { duration: '2m',  target: 30 },
    { duration: '20s', target: 0  },
  ],
  thresholds: {
    http_req_duration:         ['p(95)<500'],
    http_req_failed:           ['rate<0.01'],
    'leaderboard_duration':    ['p(95)<300'],
    'puzzles_duration':        ['p(95)<400'],
  },
}

const leaderboardDuration = new Trend('leaderboard_duration', true)
const puzzlesDuration     = new Trend('puzzles_duration', true)
const errorRate           = new Rate('read_errors')

export default function () {
  group('leaderboard', () => {
    const periods = ['all', 'weekly', 'monthly']
    const period  = periods[Math.floor(Math.random() * periods.length)]
    const res = http.get(`${BASE_URL}/api/v1/leaderboard?period=${period}&limit=20`, { headers })
    const ok = check(res, { 'status 200': r => r.status === 200 })
    leaderboardDuration.add(res.timings.duration)
    errorRate.add(!ok)
  })

  sleep(0.1)

  group('puzzles', () => {
    const types = ['find_win', 'block_loss', 'find_fork']
    const type  = types[Math.floor(Math.random() * types.length)]
    const res   = http.get(`${BASE_URL}/api/v1/puzzles?type=${type}&count=5`, { headers })
    const ok    = check(res, {
      'status 200':     r => r.status === 200,
      'returns puzzles': r => {
        try { return Array.isArray(JSON.parse(r.body).puzzles) } catch { return false }
      },
    })
    puzzlesDuration.add(res.timings.duration)
    errorRate.add(!ok)
  })

  sleep(0.1)

  group('rooms', () => {
    const res = http.get(`${BASE_URL}/api/v1/rooms`, { headers })
    check(res, { 'status 200': r => r.status === 200 })
  })

  group('ai-implementations', () => {
    const res = http.get(`${BASE_URL}/api/v1/ai/implementations`, { headers })
    check(res, { 'status 200': r => r.status === 200 })
  })

  sleep(Math.random() * 0.5 + 0.1)
}
