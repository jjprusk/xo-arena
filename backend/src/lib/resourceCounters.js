// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Resource counters — obtain/release tracking for sockets, rooms, and Redis connections.
 *
 * All four layers use the same pattern: increment on obtain, decrement on release.
 * A counter that only increments is a leak. A counter that goes negative is a double-release bug.
 *
 * Layers:
 *   1. Socket connections  — via socketHandler (connection / disconnect)
 *   2. Event listeners     — via trackedOn helper (socket.on / socket.off + disconnect)
 *   3. Rooms               — via roomManager.roomCount (polled at snapshot time)
 *   4. Redis connections   — via activityService and socketHandler Redis adapter
 *
 * The snapshot buffer (last 20 readings, one per minute) drives the leak detector.
 * Leak = N consecutive snapshots where a counter strictly increases (default N=3).
 */

import db from './db.js'
import logger from '../logger.js'
import { dispatch, getDispatchCounters } from './notificationBus.js'
import { getDispatcherHeartbeat } from './scheduledJobs.js'
import { getPendingPvpMatchCount } from './tournamentBridge.js'
import { getTotalWatchers as getTableWatcherTotal } from '../realtime/tablePresence.js'

// ── Counters ──────────────────────────────────────────────────────────────────

let _socketCount = 0
let _redisConnectionCount = 0

export function incrementSocket() { _socketCount++ }
export function decrementSocket() {
  _socketCount--
  if (_socketCount < 0) {
    logger.warn('resourceCounters: socketCount went negative — double-release bug')
    _socketCount = 0
  }
}

export function incrementRedis() { _redisConnectionCount++ }
export function decrementRedis() {
  _redisConnectionCount--
  if (_redisConnectionCount < 0) {
    logger.warn('resourceCounters: redisConnectionCount went negative — double-release bug')
    _redisConnectionCount = 0
  }
}

export function getSocketCount() { return _socketCount }
export function getRedisConnectionCount() { return _redisConnectionCount }

// ── Listener tracker ──────────────────────────────────────────────────────────

/**
 * Wrap socket.on() with a listener counter.
 * Returns a cleanup function that calls socket.off() and decrements the counter.
 *
 * Usage:
 *   const cleanup = trackedOn(socket, 'game:move', handler)
 *   // on disconnect:
 *   cleanup()
 */
export function trackedOn(socket, event, handler) {
  if (socket._trackedListenerCount === undefined) socket._trackedListenerCount = 0
  socket._trackedListenerCount++
  socket.on(event, handler)
  return () => {
    socket._trackedListenerCount--
    socket.off(event, handler)
  }
}

// ── Snapshot buffer ───────────────────────────────────────────────────────────

const SNAPSHOT_BUFFER_SIZE = 20
const LEAK_WINDOW = 3          // consecutive rising snapshots before alerting
const SNAPSHOT_INTERVAL_MS = 60_000

// Minimum absolute value before a rising trend is considered a leak.
// Low counts rising from near-zero are normal startup/idle behaviour.
const LEAK_MIN = {
  sockets:          10,   // fewer than 10 open sockets is idle noise
  rooms:             5,   // a handful of rooms is normal
  redisConnections:  5,   // adapter creates a few connections on startup
  memoryMb:        150,   // heap below 150 MB rising slightly is fine
}

// Minimum total growth across the window before alerting.
// Filters out slow natural drift where each tick rises by just 1.
const LEAK_MIN_GROWTH = {
  sockets:          3,
  rooms:            2,
  redisConnections: 3,
  memoryMb:        20,   // MB
}

const _snapshots = []          // circular, newest last
const _alerts = {}             // { sockets: bool, rooms: bool, redisConnections: bool, memoryMb: bool }
let _roomCountFn = null        // injected by startSnapshotInterval to avoid circular import

export function getSnapshots() { return [..._snapshots] }
export function getLatestSnapshot() { return _snapshots.at(-1) ?? null }
export function getAlerts() { return { ..._alerts } }

/**
 * Start the periodic snapshot interval.
 * @param {() => number} getRoomCount  — function that returns current room count
 */
export function startSnapshotInterval(getRoomCount) {
  _roomCountFn = getRoomCount
  // Take one immediately so the health endpoint always returns non-null data
  takeSnapshot()
  const id = setInterval(() => takeSnapshot(), SNAPSHOT_INTERVAL_MS)
  // Don't block process exit
  if (id.unref) id.unref()
  return id
}

async function takeBusSnapshot() {
  const [queueDepth, pending, running, failed] = await Promise.all([
    db.userNotification.count({ where: { deliveredAt: null } }),
    db.scheduledJob.count({ where: { status: 'PENDING' } }),
    db.scheduledJob.count({ where: { status: 'RUNNING' } }),
    db.scheduledJob.count({ where: { status: 'FAILED'  } }),
  ])
  return {
    notifQueueDepth:      queueDepth,
    schedulerPending:     pending,
    schedulerRunning:     running,
    schedulerFailed:      failed,
    pvpMatchMapSize:      getPendingPvpMatchCount(),
    dispatcherLastTickAt: getDispatcherHeartbeat(),
    dispatchCounters:     getDispatchCounters(),
  }
}

/**
 * Phase 3.2 (and ongoing): Tables + presence instrumentation.
 * Stale-FORMING threshold: tables in FORMING state older than 30 min with
 * zero occupied seats. Not (yet) a leak alert — stale private tables can
 * be legitimate (creator hasn't shared the link yet). Surfaced as a metric
 * so admins can spot abandoned table buildup.
 */
const STALE_TABLE_MS = 30 * 60 * 1000

async function takeTablesSnapshot() {
  const cutoff = new Date(Date.now() - STALE_TABLE_MS)
  const [forming, active, completed, staleForming] = await Promise.all([
    db.table.count({ where: { status: 'FORMING'   } }),
    db.table.count({ where: { status: 'ACTIVE'    } }),
    db.table.count({ where: { status: 'COMPLETED' } }),
    db.table.count({ where: { status: 'FORMING', createdAt: { lt: cutoff } } }),
  ])
  return {
    tablesForming:      forming,
    tablesActive:       active,
    tablesCompleted:    completed,
    tablesStaleForming: staleForming,
    tableWatchers:      getTableWatcherTotal(),
  }
}

async function takeSnapshot() {
  const [busSnap, tableSnap] = await Promise.all([
    takeBusSnapshot().catch(() => ({})),
    takeTablesSnapshot().catch(() => ({})),
  ])
  const mem = process.memoryUsage()
  const snap = {
    ts: Date.now(),
    sockets: _socketCount,
    rooms: _roomCountFn ? _roomCountFn() : 0,
    redisConnections: _redisConnectionCount,
    memoryMb:      Math.round(mem.heapUsed  / 1024 / 1024),
    heapTotalMb:   Math.round(mem.heapTotal / 1024 / 1024),
    rssMb:         Math.round(mem.rss       / 1024 / 1024),
    ...busSnap,
    ...tableSnap,
  }

  _snapshots.push(snap)
  if (_snapshots.length > SNAPSHOT_BUFFER_SIZE) _snapshots.shift()

  checkForLeaks()

  logger.info(snap, 'Resource health snapshot')
}

// ── Leak detection ────────────────────────────────────────────────────────────

function checkForLeaks() {
  if (_snapshots.length < LEAK_WINDOW) return

  const window = _snapshots.slice(-LEAK_WINDOW)

  for (const key of ['sockets', 'rooms', 'redisConnections', 'memoryMb']) {
    const latest = window.at(-1)[key]
    const first  = window[0][key]
    const rising = window.every((s, i) => i === 0 || s[key] > window[i - 1][key])
                   && latest >= (LEAK_MIN[key] ?? 0)
                   && (latest - first) >= (LEAK_MIN_GROWTH[key] ?? 1)

    if (rising && !_alerts[key]) {
      _alerts[key] = true
      logger.warn(
        { key, window: window.map(s => ({ ts: s.ts, value: s[key] })) },
        `Resource leak detected: ${key} has risen for ${LEAK_WINDOW} consecutive snapshots`
      )
      notifyAdmins(key).catch(err => logger.warn({ err }, 'Failed to notify admins of resource leak'))
    }

    if (!rising && _alerts[key]) {
      _alerts[key] = false
      logger.info({ key }, `Resource alert cleared: ${key} is no longer climbing`)
      notifyAdminsCleared(key).catch(err => logger.warn({ err }, 'Failed to notify admins of alert cleared'))
    }
  }

  // Bus queue depth
  const queueDepth = window.at(-1)['notifQueueDepth'] ?? 0
  const queueFirst = window[0]['notifQueueDepth'] ?? 0
  if (
    queueDepth !== undefined &&
    window.every((s, i) => i === 0 || (s.notifQueueDepth ?? 0) > (window[i-1].notifQueueDepth ?? 0)) &&
    queueDepth >= 50 &&
    (queueDepth - queueFirst) >= 10 &&
    !_alerts['notifQueueDepth']
  ) {
    _alerts['notifQueueDepth'] = true
    logger.warn({ queueDepth }, 'Resource leak: notification queue depth rising')
    notifyAdmins('notifQueueDepth').catch(() => {})
  }

  // Scheduler FAILED jobs
  const failedJobs = window.at(-1)['schedulerFailed'] ?? 0
  if (failedJobs > 0 && !_alerts['schedulerFailed']) {
    _alerts['schedulerFailed'] = true
    logger.warn({ failedJobs }, 'Resource alert: scheduled jobs have failed')
    notifyAdmins('schedulerFailed').catch(() => {})
  }
  if (failedJobs === 0 && _alerts['schedulerFailed']) {
    _alerts['schedulerFailed'] = false
    logger.info('Resource alert cleared: no more failed scheduled jobs')
    notifyAdminsCleared('schedulerFailed').catch(() => {})
  }

  // Dispatcher heartbeat stale (>90s)
  const lastTick = getDispatcherHeartbeat()
  const heartbeatStale = lastTick && (Date.now() - lastTick.getTime()) > 90_000
  if (heartbeatStale && !_alerts['dispatcherHeartbeat']) {
    _alerts['dispatcherHeartbeat'] = true
    logger.warn({ lastTick }, 'Resource alert: dispatcher heartbeat stale (>90s)')
    notifyAdmins('dispatcherHeartbeat').catch(() => {})
  }
  if (!heartbeatStale && _alerts['dispatcherHeartbeat']) {
    _alerts['dispatcherHeartbeat'] = false
    logger.info('Resource alert cleared: dispatcher heartbeat is healthy')
    notifyAdminsCleared('dispatcherHeartbeat').catch(() => {})
  }
}

async function notifyAdmins(key) {
  const baAdmins = await db.baUser.findMany({ where: { role: 'admin' }, select: { id: true } })
  const baAdminIds = baAdmins.map(b => b.id)
  const admins = await db.user.findMany({
    where: { betterAuthId: { in: baAdminIds } },
    select: { id: true },
  })
  const adminIds = admins.map(a => a.id)
  if (adminIds.length === 0) return
  await dispatch({
    type: 'system.alert',
    targets: { cohort: adminIds },
    payload: { key, message: `Resource counter "${key}" has risen for ${LEAK_WINDOW} consecutive snapshots. Check the health dashboard.` },
  })
}

async function notifyAdminsCleared(key) {
  const baAdmins = await db.baUser.findMany({ where: { role: 'admin' }, select: { id: true } })
  const admins = await db.user.findMany({
    where: { betterAuthId: { in: baAdmins.map(b => b.id) } },
    select: { id: true },
  })
  const adminIds = admins.map(a => a.id)
  if (adminIds.length === 0) return
  await dispatch({
    type: 'system.alert.cleared',
    targets: { cohort: adminIds },
    payload: { key, message: `Resource alert cleared: "${key}" is no longer climbing.` },
  })
}
