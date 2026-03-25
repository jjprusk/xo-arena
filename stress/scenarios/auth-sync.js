/**
 * Auth sync burst test
 *
 * Simulates a wave of users signing in simultaneously — each VU calls
 * POST /users/sync (the endpoint hit after every Better Auth login).
 *
 * Requires: AUTH_TOKEN env var with a valid JWT.
 * Without it, the test will report 401s and serve as a canary that the
 * auth middleware is working (expected failures, not real errors).
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'
import { BASE_URL, AUTH_TOKEN, headers } from '../config.js'

export const options = {
  scenarios: {
    burst: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 100,
      stages: [
        { duration: '10s', target: 5  },
        { duration: '20s', target: 20 },
        { duration: '10s', target: 50 },  // spike
        { duration: '20s', target: 10 },
        { duration: '10s', target: 0  },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    'sync_errors':     ['rate<0.01'],
  },
}

const syncErrors   = new Rate('sync_errors')
const syncDuration = new Trend('sync_duration', true)

export default function () {
  if (!AUTH_TOKEN) {
    // No token — just verify 401 is returned quickly (auth middleware health)
    const res = http.post(`${BASE_URL}/api/v1/users/sync`, '{}', {
      headers: { 'Content-Type': 'application/json' },
    })
    check(res, { 'returns 401 without token': r => r.status === 401 })
    sleep(0.2)
    return
  }

  const res = http.post(`${BASE_URL}/api/v1/users/sync`, '{}', { headers })
  const ok  = check(res, {
    'status 200 or 201': r => r.status === 200 || r.status === 201,
    'has user id':       r => {
      try { return !!JSON.parse(r.body).id } catch { return false }
    },
  })

  syncDuration.add(res.timings.duration)
  syncErrors.add(!ok)

  sleep(Math.random() * 0.3)
}
