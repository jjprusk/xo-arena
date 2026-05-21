// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Active-session registry — A3b.4.
 *
 * The worker process tracks which TrainingSession ids are currently
 * being handled. SIGTERM hits → shutdown handler iterates the registry
 * and asks each session to pause; the training loop's next tick sees
 * the signalBus pause flag, force-writes a checkpoint, and transitions
 * the row to PENDING + pausedAt. Only after that does the worker close
 * the BullMQ connection.
 *
 * Why a separate module: the handler and the shutdown path live in two
 * different files (`jobs/trainingStart.js` and `worker.js`). Either of
 * them owning the Set forces a circular import or a hand-rolled global.
 *
 * Registry is per-process (Set in memory). It does NOT need to be
 * shared with other workers — when worker B starts up after worker A
 * dies, BullMQ's stalled-job mechanism reassigns the in-flight job
 * and the new worker registers it locally.
 */

const _active = new Set()

export function registerActiveSession(sessionId) {
  if (!sessionId) return
  _active.add(sessionId)
}

export function unregisterActiveSession(sessionId) {
  if (!sessionId) return
  _active.delete(sessionId)
}

/** Returns a snapshot array — callers may iterate freely without race. */
export function getActiveSessions() {
  return [...(_active)]
}

export function _resetActiveSessionsForTests() {
  _active.clear()
}
