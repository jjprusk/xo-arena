// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Resource counters — obtain/release tracking for sockets, tables, and Redis connections.
 *
 * All four layers use the same pattern: increment on obtain, decrement on release.
 * A counter that only increments is a leak. A counter that goes negative is a double-release bug.
 *
 * Layers:
 *   1. Socket connections  — via socketHandler (connection / disconnect)
 *   2. Event listeners     — via trackedOn helper (socket.on / socket.off + disconnect)
 *   3. Active tables       — via db.table.count (polled at snapshot time)
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
import { totalClients as sseTotalClients, getLastXreadAt as sseLastXreadAt, isLoopRunning as sseLoopRunning } from './sseBroker.js'
import { getOnlineCount as presenceOnlineCount } from './presenceStore.js'
import { getStreamLength as getTier2StreamLength } from './eventStream.js'
import { getPushCounters } from './pushService.js'

// ── Counters ──────────────────────────────────────────────────────────────────

let _socketCount = 0
let _redisConnectionCount = 0

// Phase 3.x — Table-resource hardening (chunk 2).
// `db.table.create` failure counter, keyed by Prisma error code so we can
// distinguish the P2002 (slug collision) class from genuine schema/FK
// violations. Surfaced via /health/tables; never resets within a process.
const _tableCreateErrors = { P2002: 0, P2003: 0, OTHER: 0 }

// Last successful tableGcService sweep + cumulative failure count. Reads as a
// 10-minute liveness signal: if `lastGcSuccessAt` is older than that, the
// /health/tables endpoint flips the gcStale alert true and surfaces it on
// the admin dashboard.
let _gcFailures = 0
let _gcLastSuccessAt = null

// Chunk 3 F7 — per-reason `table.released` counter. Surfaced via
// /health/tables. The reasons match the chunk-3 release paths inventory and
// are validated at the dispatch site (lib/tableReleased.js); unknown reasons
// land in OTHER so a typo in one site doesn't silently disappear.
const TABLE_RELEASED_REASONS = [
  'disconnect',
  'leave',
  'game-end',
  'gc-stale',
  'gc-idle',
  'admin',
  'guest-cleanup',
]
const _tableReleased = Object.fromEntries(
  [...TABLE_RELEASED_REASONS, 'OTHER'].map((r) => [r, 0]),
)

export function incrementTableCreateError(code) {
  if (code === 'P2002')      _tableCreateErrors.P2002++
  else if (code === 'P2003') _tableCreateErrors.P2003++
  else                       _tableCreateErrors.OTHER++
}
export function getTableCreateErrors() { return { ..._tableCreateErrors } }

export function incrementGcFailure() { _gcFailures++ }
export function recordGcSuccess()     { _gcLastSuccessAt = Date.now() }

export function incrementTableReleased(reason) {
  if (reason in _tableReleased && reason !== 'OTHER') _tableReleased[reason]++
  else                                                _tableReleased.OTHER++
}
export function getTableReleased() { return { ..._tableReleased } }
export function getGcStats() {
  return {
    failures:       _gcFailures,
    lastSuccessAt:  _gcLastSuccessAt,
    secondsSinceLastSuccess: _gcLastSuccessAt
      ? Math.round((Date.now() - _gcLastSuccessAt) / 1000)
      : null,
  }
}

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
  tablesActive:      5,   // a handful of active tables is normal
  redisConnections:  5,   // adapter creates a few connections on startup
  memoryMb:        150,   // heap below 150 MB rising slightly is fine
  sseClients:       20,   // ~2 per signed-in tab; alert only above real-traffic levels
}

// Minimum total growth across the window before alerting.
// Filters out slow natural drift where each tick rises by just 1.
const LEAK_MIN_GROWTH = {
  sockets:          3,
  tablesActive:     2,
  redisConnections: 3,
  memoryMb:        20,   // MB
  sseClients:       5,
}

const _snapshots = []          // circular, newest last
const _alerts = {}             // { sockets: bool, tablesActive: bool, redisConnections: bool, memoryMb: bool }

export function getSnapshots() { return [..._snapshots] }
export function getLatestSnapshot() { return _snapshots.at(-1) ?? null }
export function getAlerts() { return { ..._alerts } }

export function startSnapshotInterval() {
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
 * Tables + presence instrumentation. Stale-FORMING tables are FORMING rows
 * older than 30 min with zero occupied seats — chunk 2 promotes this from
 * a passive metric into a threshold alert (`STALE_FORMING_THRESHOLD`) so
 * admins get paged when abandoned table buildup crosses a clean ceiling.
 *
 * Per-mode `tablesActive` breakdown (pvp / hvb / tournament / demo) lets
 * the /health/tables dashboard show which release path is leaking before
 * the chunk-3 disconnect audit traces it.
 */
const STALE_TABLE_MS = 30 * 60 * 1000
const STALE_FORMING_THRESHOLD = 10

async function takeTablesSnapshot() {
  const cutoff = new Date(Date.now() - STALE_TABLE_MS)
  const [
    forming, active, completed, staleForming,
    activeHvb, activeTournament, activeDemo,
  ] = await Promise.all([
    db.table.count({ where: { status: 'FORMING'   } }),
    db.table.count({ where: { status: 'ACTIVE'    } }),
    db.table.count({ where: { status: 'COMPLETED' } }),
    db.table.count({ where: { status: 'FORMING', createdAt: { lt: cutoff } } }),
    // Per-mode active breakdown. The four buckets are mutually exclusive:
    // demo wins over tournament wins over hvb; whatever falls through is pvp.
    db.table.count({ where: { status: 'ACTIVE', isHvb: true,  isTournament: false, isDemo: false } }),
    db.table.count({ where: { status: 'ACTIVE', isTournament: true, isDemo: false } }),
    db.table.count({ where: { status: 'ACTIVE', isDemo: true } }),
  ])
  // PvP = ACTIVE AND NOT (hvb OR tournament OR demo). Cheaper to derive than
  // re-query with a compound NOT clause.
  const activePvp = Math.max(0, active - activeHvb - activeTournament - activeDemo)
  return {
    tablesForming:           forming,
    tablesActive:            active,
    tablesCompleted:         completed,
    tablesStaleForming:      staleForming,
    tablesActive_pvp:        activePvp,
    tablesActive_hvb:        activeHvb,
    tablesActive_tournament: activeTournament,
    tablesActive_demo:       activeDemo,
    tableWatchers:           getTableWatcherTotal(),
  }
}

async function takeSnapshot() {
  const [busSnap, tableSnap, tier2StreamLen] = await Promise.all([
    takeBusSnapshot().catch(() => ({})),
    takeTablesSnapshot().catch(() => ({})),
    getTier2StreamLength().catch(() => -1),
  ])
  const mem = process.memoryUsage()
  const pc  = getPushCounters()
  const snap = {
    ts: Date.now(),
    sockets: _socketCount,
    redisConnections: _redisConnectionCount,
    memoryMb:      Math.round(mem.heapUsed  / 1024 / 1024),
    heapTotalMb:   Math.round(mem.heapTotal / 1024 / 1024),
    rssMb:         Math.round(mem.rss       / 1024 / 1024),
    // Tier 2 / Tier 3 transport health
    sseClients:      sseTotalClients(),
    sseLastXreadAt:  sseLastXreadAt(),
    sseLoopRunning:  sseLoopRunning(),
    presenceOnline:  presenceOnlineCount(),
    tier2StreamLen,                      // Redis XLEN events:tier2:stream; -1 if Redis down
    pushAttempts:    pc.attempts,        // monotonic — rate via (snap[n]-snap[n-1])/interval
    pushSent:        pc.sent,
    pushPurged:      pc.purged,
    pushFailed:      pc.failed,
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

  for (const key of ['sockets', 'tablesActive', 'redisConnections', 'memoryMb', 'sseClients']) {
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

  // Stale-FORMING tables — absolute-threshold alert (not a leak window).
  // Once the count crosses STALE_FORMING_THRESHOLD it fires; drops back
  // below and it clears. Stale tables are buildup, not bursts, so the
  // simple threshold is more useful than a rising-trend detector.
  const staleForming = window.at(-1)['tablesStaleForming'] ?? 0
  if (staleForming >= STALE_FORMING_THRESHOLD && !_alerts['tablesStaleForming']) {
    _alerts['tablesStaleForming'] = true
    logger.warn({ staleForming, threshold: STALE_FORMING_THRESHOLD }, 'Resource alert: stale FORMING tables exceeded threshold')
    notifyAdmins('tablesStaleForming').catch(() => {})
  }
  if (staleForming < STALE_FORMING_THRESHOLD && _alerts['tablesStaleForming']) {
    _alerts['tablesStaleForming'] = false
    logger.info({ staleForming }, 'Resource alert cleared: stale FORMING tables back under threshold')
    notifyAdminsCleared('tablesStaleForming').catch(() => {})
  }

  // GC liveness — alert if we haven't recorded a successful sweep in the
  // last 10 minutes. The sweep runs every 60s, so 10 minutes covers ~10
  // missed cycles before flipping. Process-start is treated as healthy
  // until the first recorded outcome (lastSuccessAt === null = grace).
  const lastGc = _gcLastSuccessAt
  const gcStale = lastGc !== null && (Date.now() - lastGc) > 10 * 60 * 1000
  if (gcStale && !_alerts['gcStale']) {
    _alerts['gcStale'] = true
    logger.warn({ lastGc, gcFailures: _gcFailures }, 'Resource alert: tableGcService has not completed a successful sweep in >10 min')
    notifyAdmins('gcStale').catch(() => {})
  }
  if (!gcStale && _alerts['gcStale']) {
    _alerts['gcStale'] = false
    logger.info('Resource alert cleared: tableGcService is sweeping again')
    notifyAdminsCleared('gcStale').catch(() => {})
  }

  // SSE broker XREAD liveness — the loop does BLOCK 30s, so _lastXreadAt
  // should tick at least every ~30s while the loop is running. >90s stale
  // means the loop has died silently. Only alert when clients are connected
  // (the loop is lazy: no clients means `ensureLoop` may not have booted yet).
  const lastXread = sseLastXreadAt()
  const sseActiveClients = sseTotalClients()
  const sseStale = sseLoopRunning()
    && sseActiveClients > 0
    && (!lastXread || (Date.now() - lastXread) > 90_000)
  if (sseStale && !_alerts['sseBroker']) {
    _alerts['sseBroker'] = true
    logger.warn({ lastXread, sseActiveClients }, 'Resource alert: SSE broker XREAD loop stale (>90s) — live clients may stop receiving events')
    notifyAdmins('sseBroker').catch(() => {})
  }
  if (!sseStale && _alerts['sseBroker']) {
    _alerts['sseBroker'] = false
    logger.info('Resource alert cleared: SSE broker XREAD loop is healthy')
    notifyAdminsCleared('sseBroker').catch(() => {})
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
