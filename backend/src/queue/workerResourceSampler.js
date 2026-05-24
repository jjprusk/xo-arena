// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.5 — training-worker resource sampler.
 *
 * The worker runs in its own Node process (separate from the backend), so
 * `process.resourceUsage()` and `process.memoryUsage()` are only visible
 * inside that process. We sample them on a heartbeat and write the result
 * into Redis under `training:worker:metrics:<workerId>` with a short TTL.
 *
 * The backend reads those keys via the admin health endpoint — a sample
 * older than the TTL is treated as a dead/restarted worker.
 *
 * Implementation notes:
 *  - Sampling is cheap: `process.resourceUsage()` is a syscall (~µs).
 *  - We compute CPU deltas vs. the previous sample so the value is "since
 *    last heartbeat" rather than monotonic-since-boot (much easier to read
 *    in a dashboard).
 *  - workerId defaults to `${hostname()}:${pid}` so multiple workers per
 *    host don't collide. Override via opts for tests.
 */
import os from 'os'
import logger from '../logger.js'

export const WORKER_METRICS_KEY_PREFIX = 'training:worker:metrics:'
export const WORKER_METRICS_TTL_S      = 120 // 2× the default 30s heartbeat — one missed beat is OK, two is dead

function defaultWorkerId() {
  return `${os.hostname()}:${process.pid}`
}

/**
 * Capture a single resource sample. Pure function — no I/O — so tests can
 * verify the shape without mocking timers or Redis.
 */
export function captureWorkerSample({
  prev = null,
  now  = Date.now(),
  resourceUsage = process.resourceUsage(),
  memoryUsage   = process.memoryUsage(),
  uptimeSec     = process.uptime(),
  activeSessions = 0,
} = {}) {
  // resourceUsage gives microseconds-of-CPU-since-process-start. To
  // compute "CPU since previous sample" we subtract the previous reading.
  // First sample has no delta — we report null so a dashboard can show a
  // dash instead of a misleading zero.
  const userCpuUs = resourceUsage.userCPUTime   ?? 0
  const sysCpuUs  = resourceUsage.systemCPUTime ?? 0

  let userCpuDeltaUs = null
  let sysCpuDeltaUs  = null
  let wallDeltaMs    = null
  if (prev && typeof prev.ts === 'number') {
    userCpuDeltaUs = Math.max(0, userCpuUs - (prev.userCpuUs ?? 0))
    sysCpuDeltaUs  = Math.max(0, sysCpuUs  - (prev.sysCpuUs  ?? 0))
    wallDeltaMs    = Math.max(0, now - prev.ts)
  }

  // CPU% = (cpu time used in window) / (wall time in window). Reported
  // as a single combined user+sys percentage — the breakdown is rarely
  // useful at a glance. 0..100 per core; >100% means multi-core work.
  let cpuPct = null
  if (userCpuDeltaUs !== null && wallDeltaMs && wallDeltaMs > 0) {
    cpuPct = Math.round(((userCpuDeltaUs + sysCpuDeltaUs) / 1000) / wallDeltaMs * 100)
  }

  return {
    ts: now,
    uptimeSec: Math.round(uptimeSec),
    rssMb:       Math.round(memoryUsage.rss       / 1024 / 1024),
    heapUsedMb:  Math.round(memoryUsage.heapUsed  / 1024 / 1024),
    heapTotalMb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
    externalMb:  Math.round((memoryUsage.external ?? 0) / 1024 / 1024),
    userCpuUs,
    sysCpuUs,
    userCpuDeltaUs,
    sysCpuDeltaUs,
    wallDeltaMs,
    cpuPct,
    activeSessions,
  }
}

/**
 * Start the heartbeat loop. Returns a stop() function used by SIGTERM
 * cleanup. Each tick captures a fresh sample and writes it to Redis with
 * an expiry; if the worker dies, the key disappears within TTL.
 *
 * Pass `getActiveCount` so the sample can include in-flight session count
 * without this module knowing about the active-session registry.
 */
export function startWorkerResourceSampler({
  redis,
  workerId = defaultWorkerId(),
  intervalMs = 30_000,
  ttlSeconds = WORKER_METRICS_TTL_S,
  getActiveCount = () => 0,
} = {}) {
  if (!redis) throw new Error('startWorkerResourceSampler: redis client required')

  let prev = null
  const key = `${WORKER_METRICS_KEY_PREFIX}${workerId}`

  const tick = async () => {
    try {
      const sample = captureWorkerSample({ prev, activeSessions: getActiveCount() })
      prev = sample
      // SET with EX so a dead worker's key auto-evicts.
      await redis.set(key, JSON.stringify({ workerId, ...sample }), 'EX', ttlSeconds)
    } catch (err) {
      logger.warn({ err, workerId }, 'worker resource sampler tick failed')
    }
  }

  // Take one immediately so the backend has a reading the moment the
  // worker is up; otherwise the dashboard shows "unknown" for the first
  // intervalMs after boot.
  tick().catch(() => {})

  const timer = setInterval(tick, intervalMs)
  if (timer.unref) timer.unref()

  return async function stopWorkerResourceSampler() {
    clearInterval(timer)
    try { await redis.del(key) } catch {}
  }
}
