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
  const id = setInterval(takeSnapshot, SNAPSHOT_INTERVAL_MS)
  // Don't block process exit
  if (id.unref) id.unref()
  return id
}

function takeSnapshot() {
  const snap = {
    ts: Date.now(),
    sockets: _socketCount,
    rooms: _roomCountFn ? _roomCountFn() : 0,
    redisConnections: _redisConnectionCount,
    memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
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
    const rising = window.every((s, i) => i === 0 || s[key] > window[i - 1][key])

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
    }
  }
}

async function notifyAdmins(key) {
  const admins = await db.user.findMany({
    where: { baRole: 'admin' },
    select: { id: true },
  })

  await Promise.all(admins.map(({ id }) =>
    db.userNotification.create({
      data: {
        userId: id,
        type: 'system_alert',
        payload: {
          key,
          message: `Resource counter "${key}" has risen for ${LEAK_WINDOW} consecutive snapshots. Check the health dashboard.`,
        },
      },
    }).catch(() => {}) // non-fatal per admin
  ))
}
