// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Chunk 3 F6 — single-point dispatcher for `table.released` bus events.
 *
 * Every code path that completes / deletes a Table row should call this
 * exactly once with the reason that fits its context. The helper:
 *  - increments the per-reason counter (resourceCounters → /health/tables)
 *  - dispatches `{type: 'table.released', payload: {tableId, reason, ...}}`
 *    on the broadcast bus so admin dashboards + the per-reason distribution
 *    can update in real time.
 *
 * Best-effort by design — bus dispatch errors are swallowed because callers
 * are completion paths that must not fail just because the metric pipeline
 * is misbehaving.
 */

import { dispatch } from './notificationBus.js'
import { incrementTableReleased } from './resourceCounters.js'
import logger from '../logger.js'

export const TABLE_RELEASED_REASONS = Object.freeze({
  DISCONNECT:    'disconnect',
  LEAVE:         'leave',
  GAME_END:      'game-end',
  GC_STALE:      'gc-stale',
  GC_IDLE:       'gc-idle',
  ADMIN:         'admin',
  GUEST_CLEANUP: 'guest-cleanup',
})

export function dispatchTableReleased(tableId, reason, extras = {}) {
  if (!tableId || !reason) return
  incrementTableReleased(reason)
  dispatch({
    type:    'table.released',
    targets: { broadcast: true },
    payload: { tableId, reason, ...extras },
  }).catch((err) => {
    logger.warn({ err: err.message, tableId, reason }, 'dispatchTableReleased: bus dispatch failed')
  })
}
