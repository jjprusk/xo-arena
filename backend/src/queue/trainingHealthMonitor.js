// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.5 — training-worker health monitor.
 *
 * Runs in the backend process (not the worker). Every interval it:
 *   1. Reads queue metrics via getTrainingQueueMetrics (BullMQ).
 *   2. Reads each worker's resource sample from Redis
 *      (`training:worker:metrics:*` keys, written by workerResourceSampler).
 *   3. Evaluates two threshold alerts and fires `system.alert` /
 *      `system.alert.cleared` notifications to admins on edge transitions.
 *
 * Alerts (mirror the resourceCounters.notifyAdmins pattern):
 *   - `queueStalled`  — `waiting >= queueWaitingThreshold` AND
 *                       `oldestWaitingAgeMs >= queueAgeThresholdMs`. The
 *                       work is piled up *and* the head is old, which is
 *                       what we actually care about ("jobs sitting
 *                       around"). A burst that drains fast doesn't fire.
 *   - `deadLetter`    — `failed >= 1`. A non-empty failed index after the
 *                       A3b.4 retry policy means a permanent failure has
 *                       landed — admins should look.
 *
 * Both alerts are edge-triggered: we only dispatch when the boolean
 * flips, so a sustained alert doesn't spam every tick.
 */
import logger from '../logger.js'
import { getTrainingQueueMetrics } from './queueMetrics.js'
import { WORKER_METRICS_KEY_PREFIX } from './workerResourceSampler.js'

const DEFAULTS = {
  intervalMs:             60_000,        // 1 min — matches resourceCounters cadence
  queueWaitingThreshold:  1,             // any backlog
  queueAgeThresholdMs:    5 * 60 * 1000, // 5 min — plan-doc bar
}

let _lastSnapshot = null
let _alerts       = { queueStalled: false, deadLetter: false }
let _timer        = null
let _running      = false

/**
 * Latest observed health snapshot. Returns `null` until the first tick
 * completes. The admin endpoint reads this directly.
 */
export function getTrainingHealthSnapshot() { return _lastSnapshot }
export function getTrainingHealthAlerts()    { return { ..._alerts } }

/**
 * Test-only — reset module state between tests.
 */
export function _resetTrainingHealthForTests() {
  if (_timer) clearInterval(_timer)
  _timer = null
  _running = false
  _lastSnapshot = null
  _alerts = { queueStalled: false, deadLetter: false }
}

/**
 * Read each worker's last sample from Redis. Falls back to an empty list
 * if Redis is unreachable. Stale keys (older than TTL) are filtered out
 * by Redis itself; we don't need to age-filter here.
 */
async function readWorkerSamples(redis) {
  if (!redis) return []
  let keys
  try {
    keys = await redis.keys(`${WORKER_METRICS_KEY_PREFIX}*`)
  } catch (err) {
    logger.warn({ err }, 'training health: redis.keys failed')
    return []
  }
  if (!keys?.length) return []
  let values
  try {
    values = await redis.mget(...keys)
  } catch (err) {
    logger.warn({ err }, 'training health: redis.mget failed')
    return []
  }
  return values
    .filter(Boolean)
    .map(raw => { try { return JSON.parse(raw) } catch { return null } })
    .filter(Boolean)
}

/**
 * Single evaluation tick. Exposed for tests so they don't need timers.
 *
 * @param {{
 *   redis?: any,
 *   getQueueMetrics?: () => Promise<any>,
 *   readSamples?: (redis: any) => Promise<any[]>,
 *   thresholds?: { queueWaitingThreshold?: number, queueAgeThresholdMs?: number },
 *   dispatch?: (msg: any) => Promise<void>,
 *   getAdminIds?: () => Promise<string[]>,
 *   now?: number,
 * }} [opts]
 */
export async function evaluateTrainingHealth(opts = {}) {
  const {
    redis,
    getQueueMetrics = getTrainingQueueMetrics,
    readSamples    = readWorkerSamples,
    thresholds     = {},
    dispatch,
    getAdminIds,
    now            = Date.now(),
  } = opts

  const queueWaitingThreshold = thresholds.queueWaitingThreshold ?? DEFAULTS.queueWaitingThreshold
  const queueAgeThresholdMs   = thresholds.queueAgeThresholdMs   ?? DEFAULTS.queueAgeThresholdMs

  let queue
  try {
    queue = await getQueueMetrics()
  } catch (err) {
    // Queue unreachable (Redis down, worker not deployed). Don't blow up
    // — surface a null snapshot and let the next tick retry.
    logger.warn({ err }, 'training health: queue metrics unavailable')
    _lastSnapshot = {
      ts: now, queue: null, workers: [], alerts: { ..._alerts },
      thresholds: { queueWaitingThreshold, queueAgeThresholdMs },
    }
    return _lastSnapshot
  }

  const workers = await readSamples(redis)

  // queueStalled: backlog AND head is old. Either condition alone is
  // ambiguous (a fresh burst is fine; a single old job that just got
  // grabbed shows age but waiting=0).
  const queueStalled =
    (queue.waiting ?? 0) >= queueWaitingThreshold &&
    typeof queue.oldestWaitingAgeMs === 'number' &&
    queue.oldestWaitingAgeMs >= queueAgeThresholdMs

  const deadLetter = (queue.failed ?? 0) >= 1

  const next = { queueStalled, deadLetter }
  await maybeFireAlertEdges({ prev: _alerts, next, queue, dispatch, getAdminIds })
  _alerts = next

  _lastSnapshot = {
    ts: now,
    queue,
    workers,
    alerts: { ..._alerts },
    thresholds: { queueWaitingThreshold, queueAgeThresholdMs },
  }
  return _lastSnapshot
}

async function maybeFireAlertEdges({ prev, next, queue, dispatch, getAdminIds }) {
  if (!dispatch || !getAdminIds) return
  for (const key of ['queueStalled', 'deadLetter']) {
    if (next[key] === prev[key]) continue
    let adminIds = []
    try { adminIds = await getAdminIds() } catch (err) {
      logger.warn({ err, key }, 'training health: getAdminIds failed')
      continue
    }
    if (!adminIds.length) continue
    try {
      const type    = next[key] ? 'system.alert' : 'system.alert.cleared'
      const message = next[key]
        ? messageFor(key, queue)
        : `Training health alert cleared: ${key}.`
      await dispatch({
        type,
        targets: { cohort: adminIds },
        payload: { key, source: 'training', message, queue },
      })
      logger.info({ key, fired: next[key] }, 'training health alert edge dispatched')
    } catch (err) {
      logger.warn({ err, key }, 'training health: alert dispatch failed')
    }
  }
}

function messageFor(key, q) {
  if (key === 'queueStalled') {
    const ageS = q?.oldestWaitingAgeMs ? Math.round(q.oldestWaitingAgeMs / 1000) : 0
    return `Training queue stalled: ${q?.waiting ?? 0} waiting, oldest ${ageS}s. Check worker health.`
  }
  if (key === 'deadLetter') {
    return `Training dead-letter non-empty: ${q?.failed ?? 0} failed job(s). See /admin/training/dead-letter.`
  }
  return `Training health alert: ${key}.`
}

/**
 * Start the periodic monitor. Idempotent — second calls are no-ops, so
 * it's safe to invoke from server boot without guarding the call site.
 *
 * @param {{
 *   redis: any,
 *   dispatch: (msg: any) => Promise<void>,
 *   getAdminIds: () => Promise<string[]>,
 *   intervalMs?: number,
 *   thresholds?: { queueWaitingThreshold?: number, queueAgeThresholdMs?: number },
 * }} opts
 */
export function startTrainingHealthMonitor(opts) {
  if (_running) return _timer
  if (!opts?.redis || !opts?.dispatch || !opts?.getAdminIds) {
    throw new Error('startTrainingHealthMonitor: redis, dispatch, and getAdminIds are required')
  }
  _running = true
  const intervalMs = opts.intervalMs ?? DEFAULTS.intervalMs

  const tick = () => {
    evaluateTrainingHealth({
      redis:       opts.redis,
      dispatch:    opts.dispatch,
      getAdminIds: opts.getAdminIds,
      thresholds:  opts.thresholds,
    }).catch(err => logger.warn({ err }, 'training health: evaluation tick failed'))
  }

  // Run once immediately so the admin endpoint has data right after boot.
  tick()
  _timer = setInterval(tick, intervalMs)
  if (_timer.unref) _timer.unref()
  logger.info({ intervalMs }, 'training health monitor started')
  return _timer
}
