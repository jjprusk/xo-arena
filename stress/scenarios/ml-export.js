/**
 * ML model export stress test
 *
 * Simulates multiple browser clients downloading model weights for local
 * inference (the loadModel() call in mlInference.js). This is the heaviest
 * read payload — a trained Q-table or neural net can be 100 KB–2 MB.
 *
 * Requires: AUTH_TOKEN env var (model list needs auth on some models)
 *           ML_MODEL_IDS env var — comma-separated list of model IDs to hit
 *           e.g. ML_MODEL_IDS=abc123,def456 k6 run stress/scenarios/ml-export.js
 *
 * If ML_MODEL_IDS is not set, the script first fetches /ml/models to discover IDs.
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend, Rate } from 'k6/metrics'
import { BASE_URL, headers } from '../config.js'

export const options = {
  stages: [
    { duration: '20s', target: 10 },
    { duration: '1m',  target: 10 },
    { duration: '20s', target: 30 },
    { duration: '30s', target: 30 },
    { duration: '15s', target: 0  },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],   // exports can be large
    http_req_failed:   ['rate<0.01'],
    'export_duration': ['p(95)<2000'],
  },
}

const exportDuration = new Trend('export_duration', true)
const exportSize     = new Trend('export_bytes')
const errorRate      = new Rate('export_errors')

// Populated in setup(), shared across VUs via return value
export function setup() {
  const envIds = __ENV.ML_MODEL_IDS
  if (envIds) return { modelIds: envIds.split(',').map(s => s.trim()) }

  // Auto-discover from model list
  const res = http.get(`${BASE_URL}/api/v1/ml/models`, { headers })
  if (res.status !== 200) return { modelIds: [] }
  try {
    const models = JSON.parse(res.body)
    return { modelIds: models.slice(0, 10).map(m => m.id) }
  } catch {
    return { modelIds: [] }
  }
}

export default function ({ modelIds }) {
  if (!modelIds || modelIds.length === 0) {
    console.warn('No model IDs — set ML_MODEL_IDS env var or ensure /ml/models returns data')
    sleep(1)
    return
  }

  const id  = modelIds[Math.floor(Math.random() * modelIds.length)]
  const res = http.get(`${BASE_URL}/api/v1/ml/models/${id}/export`, { headers })

  const ok = check(res, {
    'status 200':        r => r.status === 200,
    'has algorithm':     r => {
      try { return typeof JSON.parse(r.body).algorithm === 'string' } catch { return false }
    },
  })

  exportDuration.add(res.timings.duration)
  exportSize.add(res.body.length)
  errorRate.add(!ok)

  sleep(Math.random() * 1 + 0.5)  // 0.5–1.5s between downloads
}
