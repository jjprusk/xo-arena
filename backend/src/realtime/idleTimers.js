// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * idleTimers — per-(userId, tableId) idle warn + forfeit timer machinery.
 *
 * Rebuilt for the SSE+POST transport after the legacy socket.io idle path
 * was retired in Phase 8. The flow is:
 *
 *   • The client posts `/rt/tables/:slug/idle/pong` on visibilitychange,
 *     focus, and after every successful move (`tableFlow.applyMove`).
 *   • Each pong/move calls `arm({ userId, tableId, slug, io })`. If a timer
 *     already exists for this (user, table), it is reset; otherwise one is
 *     scheduled fresh.
 *   • At `game.idleWarnSeconds` (default 120) of silence we append:
 *       - `table:<id>:state` `{ kind: 'idle:warn', userId, secondsRemaining }`
 *       - `user:<id>:idle`   `{ kind: 'warning',  tableId, secondsRemaining }`
 *     so both the spectator-aware table channel and the user's personal
 *     channel surface the "Still there?" prompt.
 *   • At `game.idleWarnSeconds + game.idleGraceSeconds` (default +60) we
 *     call `applyForfeit()` from disconnectForfeitService — the same code
 *     path used after a real disconnect's 60-second grace window expires.
 *     `reason: 'idle'` is recorded on the forfeit event so the UI can
 *     distinguish.
 *
 * Cancellation: `cancel`, `cancelAllForUser`, and `cancelAllForTable` are
 * called from session disposal, /leave, /forfeit, and table COMPLETED
 * transitions so a finished game never leaks a timer.
 *
 * State is in-process. Each backend instance owns timers for sessions
 * connected to it; if a user's SSE session moves to a different node, the
 * old node's timer becomes a no-op (the table will no longer be ACTIVE by
 * the time it fires, or the user will have re-pinged the new node).
 */
import logger from '../logger.js'
import db from '../lib/db.js'
import { appendToStream } from '../lib/eventStream.js'
import { getSystemConfig } from '../services/skillService.js'
import {
  applyForfeit,
  resolveSeatIdForUser,
} from '../services/disconnectForfeitService.js'

const DEFAULT_WARN_SEC  = 120
const DEFAULT_GRACE_SEC = 60

// `${userId}|${tableId}` → { warnTimer, forfeitTimer, slug }
const _timers = new Map()
function key(userId, tableId) { return `${userId}|${tableId}` }

async function _readConfig() {
  const [warn, grace] = await Promise.all([
    getSystemConfig('game.idleWarnSeconds',  DEFAULT_WARN_SEC),
    getSystemConfig('game.idleGraceSeconds', DEFAULT_GRACE_SEC),
  ])
  return {
    warnMs:  Math.max(1, Number(warn)  || DEFAULT_WARN_SEC)  * 1000,
    graceMs: Math.max(1, Number(grace) || DEFAULT_GRACE_SEC) * 1000,
  }
}

function _clearEntry(entry) {
  if (!entry) return
  if (entry.warnTimer)    clearTimeout(entry.warnTimer)
  if (entry.forfeitTimer) clearTimeout(entry.forfeitTimer)
}

/**
 * Arm (or reset) the idle timers for `(userId, tableId)`. Safe to call on
 * every pong/move — re-entrant. No-ops for falsy userId (guest paths).
 *
 * `userId` is the application User.id (cuid). The per-user SSE channel
 * uses the BetterAuth id (`user:<BA_ID>:idle`) because that's the id the
 * client has from `authSession.user.id`. We resolve once at arm time and
 * cache it on the timer entry — the SSE broker filter still keys off the
 * application User.id (carried in the `userId` arg to appendToStream).
 */
export async function arm({ userId, tableId, slug = null, io = null }) {
  if (!userId || !tableId) return
  const k = key(userId, tableId)
  const prev = _timers.get(k)
  _clearEntry(prev)

  const { warnMs, graceMs } = await _readConfig()
  const baId = prev?.baId ?? await _resolveBaId(userId)
  const entry = { warnTimer: null, forfeitTimer: null, slug, baId }

  entry.warnTimer = setTimeout(() => _onWarn({ userId, baId, tableId, slug, io, graceMs, entry, k }), warnMs)
  _timers.set(k, entry)
}

async function _resolveBaId(userId) {
  try {
    const u = await db.user.findUnique({ where: { id: userId }, select: { betterAuthId: true } })
    return u?.betterAuthId ?? null
  } catch {
    return null
  }
}

function _onWarn({ userId, baId, tableId, slug, io, graceMs, entry, k }) {
  const secondsRemaining = Math.round(graceMs / 1000)
  appendToStream(
    `table:${tableId}:state`,
    { kind: 'idle:warn', userId, slug, secondsRemaining },
    { userId: '*' },
  ).catch(() => {})
  // Channel uses BA id so it matches `useGameSDK.idleChannel` (built from
  // `authSession.user.id`); broker filter still uses the application
  // User.id so security/routing is unchanged.
  if (baId) {
    appendToStream(
      `user:${baId}:idle`,
      { kind: 'warning', tableId, slug, secondsRemaining },
      { userId },
    ).catch(() => {})
  }
  logger.info({ userId, baId, tableId, secondsRemaining }, 'idle warn fired')

  // Schedule the forfeit; if the user pongs in the grace window, `arm`
  // reruns and clears these timers before this fires.
  entry.forfeitTimer = setTimeout(async () => {
    _timers.delete(k)
    try {
      const seatId = await resolveSeatIdForUser({ userId, sessionId: null, tableId })
      if (!seatId) return
      const result = await applyForfeit({ io, seatId, tableId, reason: 'idle' })
      if (!result.ok) {
        logger.info({ userId, tableId, code: result.code }, 'idle forfeit no-op')
      } else {
        logger.info({ userId, tableId }, 'idle forfeit applied')
      }
    } catch (err) {
      logger.warn({ err: err.message, userId, tableId }, 'idle forfeit failed')
    }
  }, graceMs)
}

/** Reset is just `arm` — kept as a named export for call-site clarity. */
export const reset = arm

/** Cancel any pending warn/forfeit timer for `(userId, tableId)`. */
export function cancel({ userId, tableId }) {
  if (!userId || !tableId) return false
  const k = key(userId, tableId)
  const entry = _timers.get(k)
  if (!entry) return false
  _clearEntry(entry)
  _timers.delete(k)
  return true
}

/** Cancel every timer for this user across every table. Used on SSE
 *  session disposal so the user's last node doesn't fire a forfeit after
 *  they've been picked up by `disconnectForfeitService` instead. */
export function cancelAllForUser(userId) {
  if (!userId) return 0
  let n = 0
  for (const [k, entry] of _timers) {
    if (k.startsWith(`${userId}|`)) {
      _clearEntry(entry)
      _timers.delete(k)
      n++
    }
  }
  return n
}

/** Cancel every timer scoped to this table — called when the table
 *  transitions to COMPLETED so neither player gets an idle:warn after the
 *  game is already over. */
export function cancelAllForTable(tableId) {
  if (!tableId) return 0
  let n = 0
  for (const [k, entry] of _timers) {
    if (k.endsWith(`|${tableId}`)) {
      _clearEntry(entry)
      _timers.delete(k)
      n++
    }
  }
  return n
}

// ── Test hooks ──────────────────────────────────────────────────────────────
export function _hasTimer({ userId, tableId }) {
  return _timers.has(key(userId, tableId))
}
export function _resetForTests() {
  for (const entry of _timers.values()) _clearEntry(entry)
  _timers.clear()
}
