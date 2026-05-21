// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.5 — training queue metrics.
 *
 * Reads BullMQ's `getJobCounts()` plus the oldest waiting job's age so we
 * can fire an alert when work is stuck (`>N waiting for >5min`). Returns
 * a plain object — callers (snapshot pipeline, admin endpoint, tests)
 * decide what to do with it.
 *
 * No Redis I/O at import time; `getTrainingQueueMetrics()` lazily reaches
 * through `getTrainingQueue()`. Pass a queue override in tests to avoid
 * needing a live Redis.
 */
import { getTrainingQueue } from './trainingQueue.js'

/**
 * Snapshot the training queue's job-state counters + oldest-waiting age.
 *
 * @param {{ queue?: any, now?: number }} [opts]
 * @returns {Promise<{
 *   waiting: number, active: number, delayed: number, failed: number,
 *   completed: number, prioritized: number,
 *   oldestWaitingAgeMs: number | null,
 * }>}
 */
export async function getTrainingQueueMetrics(opts = {}) {
  const queue = opts.queue ?? getTrainingQueue()
  const now   = opts.now   ?? Date.now()

  // BullMQ batches every job-state count in one Redis round trip.
  const counts = await queue.getJobCounts(
    'waiting', 'active', 'delayed', 'failed', 'completed', 'prioritized',
  )

  // Oldest waiting job — getWaiting(0, 0) returns just the head of the
  // waiting list (smallest LIFO/FIFO index, i.e. the next job to run).
  // `timestamp` is set by BullMQ on add(); fall back to enqueuedAt in
  // job.data if a job pre-dates the timestamp field (defensive).
  let oldestWaitingAgeMs = null
  if ((counts.waiting ?? 0) > 0) {
    try {
      const [head] = await queue.getWaiting(0, 0)
      if (head) {
        const enqueued =
          head.timestamp ??
          head.data?.enqueuedAt ??
          null
        if (typeof enqueued === 'number') {
          oldestWaitingAgeMs = Math.max(0, now - enqueued)
        }
      }
    } catch {
      // getWaiting can race with workers consuming the head. We treat a
      // failure here as "unknown age" rather than blowing up the whole
      // metrics fetch — the count is still useful on its own.
      oldestWaitingAgeMs = null
    }
  }

  return {
    waiting:    counts.waiting    ?? 0,
    active:     counts.active     ?? 0,
    delayed:    counts.delayed    ?? 0,
    failed:     counts.failed     ?? 0,
    completed:  counts.completed  ?? 0,
    prioritized: counts.prioritized ?? 0,
    oldestWaitingAgeMs,
  }
}
