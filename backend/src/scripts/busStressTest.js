// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Notification bus + scheduler stress test
 *
 * Tests two things the OOM raised questions about:
 *   1. Connection leak — do Postgres connections accumulate over idle cycles?
 *   2. Throughput — how many dispatches/sec and jobs/sec can the system sustain?
 *
 * Usage (from backend/):
 *   node --env-file=../.env src/scripts/busStressTest.js [options]
 *
 * Options:
 *   --users=N          test users to create (default 10)
 *   --duration=N       seconds for throughput phase (default 30)
 *   --concurrency=N    parallel dispatch calls (default 20)
 *   --idle=N           idle seconds between leak-test bursts (default 20)
 *   --jobs=N           scheduled jobs to create for scheduler test (default 50)
 *   --verbose          print per-operation timing
 *
 * All test data is prefixed with "stress_" and cleaned up on exit.
 */

import 'dotenv/config'
import db from '../lib/db.js'
import { dispatch, initBus } from '../lib/notificationBus.js'
import {
  startDispatcher,
  scheduleJob,
  registerHandler,
  runDispatcherTick,
} from '../lib/scheduledJobs.js'

// ── CLI args ──────────────────────────────────────────────────────────────────

const ARGS = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=')
      return [k, v ?? 'true']
    })
)

const NUM_USERS    = parseInt(ARGS.users       ?? '10',  10)
const DURATION_S   = parseInt(ARGS.duration    ?? '30',  10)
const CONCURRENCY  = parseInt(ARGS.concurrency ?? '20',  10)
const IDLE_S       = parseInt(ARGS.idle        ?? '20',  10)
const NUM_JOBS     = parseInt(ARGS.jobs        ?? '50',  10)
const VERBOSE      = ARGS.verbose === 'true'

// ── Helpers ───────────────────────────────────────────────────────────────────

const log  = (...args) => console.log(new Date().toISOString().slice(11, 23), ...args)
const sep  = (label) => console.log(`\n${'─'.repeat(60)}\n  ${label}\n${'─'.repeat(60)}`)
const wait = (ms) => new Promise(r => setTimeout(r, ms))

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length * p / 100)] ?? 0
}

// ── Connection monitor (polls pg_stat_activity) ───────────────────────────────

async function getConnectionCount() {
  const result = await db.$queryRaw`
    SELECT count(*)::int AS n
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid != pg_backend_pid()
      AND state IS NOT NULL
  `
  return result[0]?.n ?? 0
}

async function monitorConnections(label, durationMs, intervalMs = 2000) {
  const samples = []
  const deadline = Date.now() + durationMs
  while (Date.now() < deadline) {
    const n = await getConnectionCount()
    samples.push(n)
    if (VERBOSE) log(`[conns] ${label}: ${n}`)
    if (Date.now() < deadline) await wait(intervalMs)
  }
  return {
    min: Math.min(...samples),
    max: Math.max(...samples),
    avg: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length),
    samples,
  }
}

// ── Test data ─────────────────────────────────────────────────────────────────

const TEST_PREFIX = 'stress_'
let testUserIds = []

async function createTestUsers() {
  log(`Creating ${NUM_USERS} test users…`)
  const users = []
  for (let i = 0; i < NUM_USERS; i++) {
    const id = `${TEST_PREFIX}user_${i}_${Date.now()}`
    const user = await db.user.create({
      data: {
        id,
        betterAuthId: `${TEST_PREFIX}ba_${i}_${Date.now()}`,
        displayName: `Stress User ${i}`,
        username:    `stress_user_${i}_${Date.now()}`,
        email:       `stress_${i}_${Date.now()}@stress.test`,
      },
    })
    users.push(user.id)
  }
  testUserIds = users
  log(`Created ${users.length} test users`)
  return users
}

async function cleanup() {
  log('Cleaning up test data…')
  try {
    // Notifications created for test users
    const del1 = await db.userNotification.deleteMany({
      where: { userId: { in: testUserIds } },
    })
    // Scheduled jobs created during the test
    const del2 = await db.scheduledJob.deleteMany({
      where: { type: { startsWith: TEST_PREFIX } },
    })
    // Test users
    const del3 = await db.user.deleteMany({
      where: { id: { in: testUserIds } },
    })
    log(`Deleted ${del1.count} notifications, ${del2.count} jobs, ${del3.count} users`)
  } catch (err) {
    log('Cleanup error (non-fatal):', err.message)
  }
}

// ── Phase 1: Connection leak test ─────────────────────────────────────────────

async function phaseLeakTest() {
  sep('Phase 1 — Connection Leak Test')
  log(`Idle ${IDLE_S}s between bursts × 3 cycles`)
  log('Watching pg_stat_activity for connection accumulation…')

  const results = []

  for (let cycle = 0; cycle < 3; cycle++) {
    // Idle period — connections should close after idleTimeoutMillis (15s)
    log(`Cycle ${cycle + 1}: idle for ${IDLE_S}s…`)
    const idleStats = await monitorConnections(`idle-${cycle}`, IDLE_S * 1000, 3000)

    // Burst — dispatch to all users simultaneously
    log(`Cycle ${cycle + 1}: dispatching burst to ${testUserIds.length} users…`)
    const before = await getConnectionCount()
    await Promise.all(
      testUserIds.map(userId =>
        dispatch({
          type: 'achievement.milestone',
          targets: { userId },
          payload: { score: 100, message: `Stress test cycle ${cycle}` },
        })
      )
    )
    const after = await getConnectionCount()
    log(`Cycle ${cycle + 1}: connections before=${before} after=${after} idle-max=${idleStats.max}`)
    results.push({ cycle, before, after, idleMax: idleStats.max })
  }

  const maxSeen   = Math.max(...results.map(r => r.after))
  const idleMax   = Math.max(...results.map(r => r.idleMax))
  const leaking   = idleMax > maxSeen + 3  // connections growing during idle = leak

  return { results, maxSeen, idleMax, leaking }
}

// ── Phase 2: Dispatch throughput ─────────────────────────────────────────────

async function phaseThroughput() {
  sep('Phase 2 — Dispatch Throughput')
  log(`Running for ${DURATION_S}s with concurrency=${CONCURRENCY}…`)

  const latencies = []
  let ops = 0
  let errors = 0
  const deadline = Date.now() + DURATION_S * 1000

  // Clear previous test notifications so dedup doesn't block all dispatches
  await db.userNotification.deleteMany({ where: { userId: { in: testUserIds } } })

  while (Date.now() < deadline) {
    const batch = Array.from({ length: CONCURRENCY }, (_, i) => {
      const userId = testUserIds[i % testUserIds.length]
      const t0 = Date.now()
      // Use different types/payloads to avoid dedup blocking
      return dispatch({
        type: 'system.alert',
        targets: { userId },
        payload: { key: `stress_${ops + i}`, message: `Stress test op ${ops + i}` },
      }).then(() => {
        latencies.push(Date.now() - t0)
      }).catch(() => { errors++ })
    })
    await Promise.all(batch)
    ops += CONCURRENCY
    if (VERBOSE) log(`ops=${ops} errors=${errors}`)
    // Clear delivered notifications so dedup doesn't permanently block
    if (ops % (CONCURRENCY * 10) === 0) {
      await db.userNotification.deleteMany({ where: { userId: { in: testUserIds } } })
    }
  }

  const elapsed  = DURATION_S
  const throughput = Math.round(ops / elapsed)
  const p50      = percentile(latencies, 50)
  const p95      = percentile(latencies, 95)
  const p99      = percentile(latencies, 99)
  const errRate  = ops > 0 ? ((errors / ops) * 100).toFixed(1) : '0.0'

  return { ops, elapsed, throughput, p50, p95, p99, errors, errRate }
}

// ── Phase 3: Scheduler throughput ────────────────────────────────────────────

async function phaseScheduler() {
  sep('Phase 3 — Scheduler Throughput')
  log(`Creating ${NUM_JOBS} jobs due immediately…`)

  // Register a no-op handler for the stress test job type
  let jobsCompleted = 0
  registerHandler(`${TEST_PREFIX}noop`, async () => {
    jobsCompleted++
  })

  const now = new Date()
  await Promise.all(
    Array.from({ length: NUM_JOBS }, (_, i) =>
      scheduleJob({ type: `${TEST_PREFIX}noop`, payload: { i }, runAt: now })
    )
  )
  log(`${NUM_JOBS} jobs scheduled, running dispatcher ticks…`)

  const t0 = Date.now()
  let ticks = 0
  const maxWaitMs = 30_000

  while (jobsCompleted < NUM_JOBS && Date.now() - t0 < maxWaitMs) {
    await runDispatcherTick()
    ticks++
    if (VERBOSE) log(`tick ${ticks}: ${jobsCompleted}/${NUM_JOBS} jobs done`)
    if (jobsCompleted < NUM_JOBS) await wait(200)
  }

  const elapsed = Date.now() - t0
  const jobsPerTick = ticks > 0 ? (jobsCompleted / ticks).toFixed(1) : 0

  // Check for failed jobs
  const failed = await db.scheduledJob.count({
    where: { type: `${TEST_PREFIX}noop`, status: 'FAILED' },
  })

  return { NUM_JOBS, jobsCompleted, ticks, elapsed, jobsPerTick, failed }
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Mock io so dispatch() doesn't fail on socket emit
initBus({
  emit: () => {},
  to:   () => ({ emit: () => {} }),
})

// Register handlers (normally done in startDispatcher, but we call it here too)
await startDispatcher()

// Ensure cleanup on exit
process.on('SIGINT',  () => cleanup().then(() => process.exit(0)))
process.on('SIGTERM', () => cleanup().then(() => process.exit(0)))

try {
  log(`BUS STRESS TEST — users=${NUM_USERS} duration=${DURATION_S}s concurrency=${CONCURRENCY}`)

  await createTestUsers()

  const leak    = await phaseLeakTest()
  const thru    = await phaseThroughput()
  const sched   = await phaseScheduler()
  const connEnd = await getConnectionCount()

  await cleanup()

  // ── Final report ────────────────────────────────────────────────────────────
  sep('RESULTS')

  console.log(`
Connection Leak Test:
  Cycles:           3 × (${IDLE_S}s idle → burst)
  Max during idle:  ${leak.idleMax} connections
  Max during burst: ${leak.maxSeen} connections
  Leak detected:    ${leak.leaking ? '⚠ YES — connections accumulated during idle' : '✓ None detected'}
  Final count:      ${connEnd}

Dispatch Throughput:
  Total ops:        ${thru.ops.toLocaleString()}
  Duration:         ${thru.elapsed}s
  Throughput:       ${thru.throughput} ops/sec
  Latency p50:      ${thru.p50}ms
  Latency p95:      ${thru.p95}ms
  Latency p99:      ${thru.p99}ms
  Error rate:       ${thru.errRate}%

Scheduler:
  Jobs scheduled:   ${sched.NUM_JOBS}
  Jobs completed:   ${sched.jobsCompleted}/${sched.NUM_JOBS}
  Jobs failed:      ${sched.failed}
  Ticks needed:     ${sched.ticks}
  Jobs/tick:        ${sched.jobsPerTick}
  Total time:       ${sched.elapsed}ms
`)

  process.exit(0)
} catch (err) {
  console.error('Stress test failed:', err)
  await cleanup()
  process.exit(1)
}
