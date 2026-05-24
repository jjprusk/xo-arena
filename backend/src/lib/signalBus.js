// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Cross-process pause / cancel signal bus — A3b.2b.
 *
 * Before A3b.2b: training ran in the backend process via setImmediate, so
 * `pauseSession()` / `cancelSession()` could just add to a local Set that
 * `_runTraining`'s next tick read. That stops working once `_runTraining`
 * is on the xo-training worker — the worker can't see the backend's Sets.
 *
 * This module gives `_runTraining` one read API (`isPaused` / `isCancelled`)
 * and the route handlers one write API (`requestPause` / `requestCancel`)
 * that works in either layout:
 *
 *   - in-memory mode (`SIGNAL_BUS_MODE=memory`, the default): identical to
 *     the old bare Sets. Backend reads its own writes. Used when the worker
 *     path is off (the `ml.useWorker` SystemConfig flag is false) and in
 *     unit tests.
 *
 *   - redis mode (`SIGNAL_BUS_MODE=redis`): every write fans out via Redis
 *     pub-sub to every process that's subscribed, and every subscriber
 *     mirrors the signal into its local Set. The worker is always a
 *     subscriber; the backend becomes one when the worker path is on.
 *
 * Why a separate module instead of folding this into eventStream.js: the
 * SSE replay stream (`events:tier2:stream`) is *durable* — clients ask for
 * events since a cursor. Pause/cancel signals are *ephemeral* — only the
 * currently-running training loop cares, and only at the next batch
 * boundary. Pub-sub is the natural primitive; XADD/XREAD is overkill and
 * conflates two channels with very different replay semantics.
 *
 * Public API (the only thing callers should touch):
 *
 *   await initSignalBus({ mode, redisUrl })  // backend boot + worker boot
 *   requestPause(sessionId) / requestCancel(sessionId)
 *   isPaused(sessionId)     / isCancelled(sessionId)
 *   clearPause(sessionId)   / clearCancel(sessionId)
 *   await closeSignalBus()  // test cleanup
 */
import IORedis from 'ioredis'
import logger from '../logger.js'

const PAUSE_CHANNEL  = 'training:signal:pause'
const CANCEL_CHANNEL = 'training:signal:cancel'

// `:clear` suffix lets a single channel carry both raise-flag and clear-flag
// commands without a per-action channel. Payload is the bare sessionId.
const CMD_RAISE = 'raise'
const CMD_CLEAR = 'clear'

const _pausedSessions    = new Set()
const _cancelledSessions = new Set()

let _mode       = 'memory'       // 'memory' | 'redis'
let _publisher  = null           // Redis client used for PUBLISH
let _subscriber = null           // Redis client used for SUBSCRIBE
let _initialized = false

/**
 * Boot the signal bus. Call once per process at startup (backend `index.js`,
 * worker `worker.js`). Idempotent — calling twice with the same mode is a
 * no-op; calling with a different mode after init throws (catch boot bugs).
 */
export async function initSignalBus({ mode = 'memory', redisUrl = process.env.REDIS_URL } = {}) {
  if (_initialized) {
    if (_mode !== mode) {
      throw new Error(`signalBus already initialized in '${_mode}' mode; cannot switch to '${mode}'`)
    }
    return
  }
  _mode = mode

  if (mode === 'redis') {
    if (!redisUrl) throw new Error('signalBus: redis mode requires REDIS_URL')
    _publisher  = new IORedis(redisUrl, { maxRetriesPerRequest: null })
    _subscriber = new IORedis(redisUrl, { maxRetriesPerRequest: null })
    _publisher.on('error',  err => logger.error({ err }, 'signalBus publisher error'))
    _subscriber.on('error', err => logger.error({ err }, 'signalBus subscriber error'))

    _subscriber.on('message', (channel, raw) => {
      const [cmd, sessionId] = String(raw).split(':')
      if (!sessionId) return
      const target = channel === PAUSE_CHANNEL ? _pausedSessions : _cancelledSessions
      if (cmd === CMD_RAISE) target.add(sessionId)
      else if (cmd === CMD_CLEAR) target.delete(sessionId)
    })
    await _subscriber.subscribe(PAUSE_CHANNEL, CANCEL_CHANNEL)
    logger.info({ channels: [PAUSE_CHANNEL, CANCEL_CHANNEL] }, 'signalBus subscribed to Redis')
  }

  _initialized = true
}

function _publish(channel, cmd, sessionId) {
  if (!_publisher) return
  _publisher.publish(channel, `${cmd}:${sessionId}`).catch(err => {
    logger.error({ err, channel, sessionId }, 'signalBus publish failed')
  })
}

export function requestPause(sessionId) {
  _pausedSessions.add(sessionId)
  if (_mode === 'redis') _publish(PAUSE_CHANNEL, CMD_RAISE, sessionId)
}

export function requestCancel(sessionId) {
  _cancelledSessions.add(sessionId)
  if (_mode === 'redis') _publish(CANCEL_CHANNEL, CMD_RAISE, sessionId)
}

export function clearPause(sessionId) {
  _pausedSessions.delete(sessionId)
  if (_mode === 'redis') _publish(PAUSE_CHANNEL, CMD_CLEAR, sessionId)
}

export function clearCancel(sessionId) {
  _cancelledSessions.delete(sessionId)
  if (_mode === 'redis') _publish(CANCEL_CHANNEL, CMD_CLEAR, sessionId)
}

export function isPaused(sessionId)    { return _pausedSessions.has(sessionId) }
export function isCancelled(sessionId) { return _cancelledSessions.has(sessionId) }

// Test-only utilities.
export async function _closeSignalBusForTests() {
  if (_publisher)  { _publisher.disconnect();  _publisher  = null }
  if (_subscriber) { _subscriber.disconnect(); _subscriber = null }
  _pausedSessions.clear()
  _cancelledSessions.clear()
  _mode = 'memory'
  _initialized = false
}

export function _signalBusModeForTests() { return _mode }
