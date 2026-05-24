// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.6 — training-worker soak harness.
 *
 * Drives the QA training-worker endpoints to simulate N concurrent users
 * × mixed algorithms over a configurable wall-clock window. Each virtual
 * user runs in a loop: pick an algorithm from the mix, POST a start, poll
 * status until COMPLETED/FAILED, repeat. Every 30 s the harness also
 * polls `/api/v1/admin/health/training` (admin-gated) so the report
 * records queue-depth + dead-letter counts during the soak — those are
 * the gates A3b.5 wired up.
 *
 * Usage (from backend/, with QA_SECRET + optional ADMIN_BEARER exported):
 *   node --experimental-transform-types --no-warnings \
 *     src/scripts/trainingWorkerSoak.js \
 *     --base=https://xo-backend-staging.fly.dev \
 *     --users=10 --duration=3600 --iterations=5000 --delay=10
 *
 * Flags:
 *   --base=URL          backend base URL (required)
 *   --users=N           virtual users / concurrent sessions (default 10)
 *   --duration=N        wall-clock soak duration in seconds (default 3600)
 *   --iterations=N      iterations per session (default 5000)
 *   --delay=N           per-episode _qaDelayMs (default 10 ms — keeps the queue warm)
 *   --algos=a,b,c       comma-separated algos with optional weights "qlearning:6,sarsa:2,monte_carlo:2"
 *   --poll=N            session-status poll interval ms (default 4000)
 *   --health-poll=N     /health/training poll interval ms (default 30000)
 *   --report=path.json  write a final report JSON (default ./soak-report.json)
 */

import { setTimeout as sleep } from 'node:timers/promises'
import { writeFileSync } from 'node:fs'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const eq = a.indexOf('=')
    if (a.startsWith('--') && eq > 0) return [a.slice(2, eq), a.slice(eq + 1)]
    if (a.startsWith('--')) return [a.slice(2), 'true']
    return [a, 'true']
  }),
)

const BASE          = (args.base || '').replace(/\/+$/, '')
const USERS         = parseInt(args.users || '10', 10)
const DURATION_S    = parseInt(args.duration || '3600', 10)
const ITERATIONS    = parseInt(args.iterations || '5000', 10)
const DELAY_MS      = parseInt(args.delay || '10', 10)
const POLL_MS       = parseInt(args.poll || '4000', 10)
const HEALTH_POLL_MS = parseInt(args['health-poll'] || '30000', 10)
const REPORT_PATH   = args.report || './soak-report.json'

const QA_SECRET     = process.env.QA_SECRET
const ADMIN_BEARER  = process.env.ADMIN_BEARER || null  // optional — health checks otherwise skipped

if (!BASE)       { console.error('--base=URL required'); process.exit(2) }
if (!QA_SECRET)  { console.error('QA_SECRET env var required'); process.exit(2) }

// Parse `--algos=qlearning:6,sarsa:2,monte_carlo:2` into a weighted picker.
function parseAlgos(raw) {
  const def = 'qlearning:6,sarsa:2,monte_carlo:2'
  const list = (raw || def).split(',').map((s) => {
    const [name, w] = s.split(':')
    return { name: name.trim(), w: parseInt(w || '1', 10) || 1 }
  })
  const total = list.reduce((a, x) => a + x.w, 0)
  return () => {
    let pick = Math.random() * total
    for (const x of list) { pick -= x.w; if (pick <= 0) return x.name }
    return list[0].name
  }
}
const pickAlgo = parseAlgos(args.algos)

const stats = {
  startedAt:   new Date().toISOString(),
  sessions:    [],
  perAlgoCount: {},
  perAlgoCompleted: {},
  perAlgoFailed:    {},
  healthSamples: [],
  errors:       [],
}

function logLine(...rest) {
  const t = new Date().toISOString().slice(11, 19)
  console.log(`[${t}]`, ...rest)
}

async function startSession({ slot, algorithm }) {
  const res = await fetch(`${BASE}/api/v1/admin/qa/training-worker/start`, {
    method:  'POST',
    headers: { 'content-type': 'application/json', 'x-qa-secret': QA_SECRET },
    body:    JSON.stringify({ slot, algorithm, iterations: ITERATIONS, delayMs: DELAY_MS }),
  })
  if (!res.ok) throw new Error(`start http ${res.status}: ${await res.text()}`)
  return res.json()
}

async function getSessionStatus(sessionId) {
  const url = `${BASE}/api/v1/admin/qa/training-recovery/status?sessionId=${encodeURIComponent(sessionId)}`
  const res = await fetch(url, { headers: { 'x-qa-secret': QA_SECRET } })
  if (!res.ok) throw new Error(`status http ${res.status}: ${await res.text()}`)
  return res.json()
}

async function pollHealthOnce() {
  if (!ADMIN_BEARER) return null
  try {
    const res = await fetch(`${BASE}/api/v1/admin/health/training`, {
      headers: { authorization: `Bearer ${ADMIN_BEARER}` },
    })
    if (!res.ok) return { error: `http ${res.status}` }
    return await res.json()
  } catch (err) {
    return { error: err.message }
  }
}

async function runVirtualUser({ slot, deadline }) {
  while (Date.now() < deadline) {
    const algorithm = pickAlgo()
    const t0 = Date.now()
    let start
    try {
      start = await startSession({ slot, algorithm })
    } catch (err) {
      stats.errors.push({ t: new Date().toISOString(), slot, algorithm, phase: 'start', message: err.message })
      logLine(`slot=${slot} algo=${algorithm} START_ERR ${err.message}`)
      await sleep(2000)
      continue
    }
    stats.perAlgoCount[algorithm] = (stats.perAlgoCount[algorithm] || 0) + 1
    logLine(`slot=${slot} algo=${algorithm} session=${start.sessionId} STARTED`)

    let final
    while (Date.now() < deadline + 60_000) {
      await sleep(POLL_MS)
      let s
      try { s = await getSessionStatus(start.sessionId) }
      catch (err) {
        stats.errors.push({ t: new Date().toISOString(), slot, algorithm, sessionId: start.sessionId, phase: 'status', message: err.message })
        continue
      }
      const sess = s.sessions?.[0]
      if (!sess) continue
      if (sess.status === 'COMPLETED' || sess.status === 'FAILED' || sess.status === 'CANCELLED') {
        final = sess
        break
      }
    }
    const dur = Date.now() - t0
    if (final && final.status === 'COMPLETED') {
      stats.perAlgoCompleted[algorithm] = (stats.perAlgoCompleted[algorithm] || 0) + 1
      logLine(`slot=${slot} algo=${algorithm} session=${start.sessionId} COMPLETED ${dur}ms`)
    } else {
      stats.perAlgoFailed[algorithm] = (stats.perAlgoFailed[algorithm] || 0) + 1
      logLine(`slot=${slot} algo=${algorithm} session=${start.sessionId} ${final?.status ?? 'TIMEOUT'} ${dur}ms`)
    }
    stats.sessions.push({
      slot, algorithm, sessionId: start.sessionId,
      status:    final?.status ?? 'TIMEOUT',
      durationMs: dur,
    })
  }
}

async function healthPoller(deadline) {
  while (Date.now() < deadline) {
    const sample = await pollHealthOnce()
    if (sample) {
      stats.healthSamples.push({ t: new Date().toISOString(), sample })
      const q = sample.latest?.queue
      if (q) {
        logLine(`HEALTH waiting=${q.waiting ?? 0} active=${q.active ?? 0} failed=${q.failed ?? 0} oldestAgeMs=${q.oldestWaitingAgeMs ?? 0} alerts=${JSON.stringify(sample.alerts)}`)
      }
    }
    await sleep(HEALTH_POLL_MS)
  }
}

async function main() {
  logLine(`SOAK start base=${BASE} users=${USERS} duration=${DURATION_S}s iter=${ITERATIONS} delay=${DELAY_MS}ms`)
  const deadline = Date.now() + DURATION_S * 1000

  const users = Array.from({ length: USERS }, (_, i) =>
    runVirtualUser({ slot: i + 1, deadline })
  )
  const health = healthPoller(deadline)

  await Promise.all([...users, health])

  stats.endedAt = new Date().toISOString()
  stats.durationS = Math.round((Date.parse(stats.endedAt) - Date.parse(stats.startedAt)) / 1000)
  stats.totals = {
    sessions: stats.sessions.length,
    completed: stats.sessions.filter(s => s.status === 'COMPLETED').length,
    failed:    stats.sessions.filter(s => s.status === 'FAILED').length,
    cancelled: stats.sessions.filter(s => s.status === 'CANCELLED').length,
    timeouts:  stats.sessions.filter(s => s.status === 'TIMEOUT').length,
    errors:    stats.errors.length,
    healthSamples: stats.healthSamples.length,
  }
  const completedDurations = stats.sessions.filter(s => s.status === 'COMPLETED').map(s => s.durationMs).sort((a, b) => a - b)
  if (completedDurations.length) {
    const p = (q) => completedDurations[Math.min(completedDurations.length - 1, Math.floor(completedDurations.length * q))]
    stats.totals.durationMs = { p50: p(0.5), p95: p(0.95), max: completedDurations.at(-1), min: completedDurations[0] }
  }
  writeFileSync(REPORT_PATH, JSON.stringify(stats, null, 2))
  logLine(`SOAK done — report at ${REPORT_PATH}`)
  logLine(`TOTALS ${JSON.stringify(stats.totals)}`)
}

main().catch((err) => {
  console.error('soak crashed:', err)
  process.exit(1)
})
