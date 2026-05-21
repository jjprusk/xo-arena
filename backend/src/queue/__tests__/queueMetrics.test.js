// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.5 — queueMetrics covers the contract the trainingHealthMonitor
 * relies on: getJobCounts() shape, the oldest-waiting-age derivation,
 * and graceful fallback when getWaiting races.
 */
import { describe, it, expect, vi } from 'vitest'
import { getTrainingQueueMetrics } from '../queueMetrics.js'

function makeQueue({ counts = {}, waitingHead = null, getWaitingThrows = false } = {}) {
  return {
    getJobCounts: vi.fn().mockResolvedValue(counts),
    getWaiting:   vi.fn().mockImplementation(() => {
      if (getWaitingThrows) throw new Error('race: head consumed')
      return Promise.resolve(waitingHead ? [waitingHead] : [])
    }),
  }
}

describe('getTrainingQueueMetrics', () => {
  it('returns zeros + null age when the queue is empty', async () => {
    const queue = makeQueue({ counts: { waiting: 0, active: 0, failed: 0 } })
    const out   = await getTrainingQueueMetrics({ queue })
    expect(out).toMatchObject({
      waiting: 0, active: 0, failed: 0, oldestWaitingAgeMs: null,
    })
    expect(queue.getWaiting).not.toHaveBeenCalled()
  })

  it('computes oldestWaitingAgeMs from job.timestamp', async () => {
    const now  = 10_000
    const head = { id: 'j1', timestamp: 7_000 }
    const out  = await getTrainingQueueMetrics({
      queue: makeQueue({ counts: { waiting: 2 }, waitingHead: head }),
      now,
    })
    expect(out.waiting).toBe(2)
    expect(out.oldestWaitingAgeMs).toBe(3_000)
  })

  it('falls back to data.enqueuedAt when timestamp is missing', async () => {
    const now  = 5_000
    const head = { id: 'j1', data: { enqueuedAt: 2_000 } }
    const out  = await getTrainingQueueMetrics({
      queue: makeQueue({ counts: { waiting: 1 }, waitingHead: head }),
      now,
    })
    expect(out.oldestWaitingAgeMs).toBe(3_000)
  })

  it('returns null age (not throw) when getWaiting races / throws', async () => {
    const out = await getTrainingQueueMetrics({
      queue: makeQueue({ counts: { waiting: 1 }, getWaitingThrows: true }),
      now: 1,
    })
    expect(out.waiting).toBe(1)
    expect(out.oldestWaitingAgeMs).toBeNull()
  })

  it('clamps negative age to 0 (clock skew defense)', async () => {
    const now  = 1_000
    const head = { id: 'j1', timestamp: 5_000 } // job appears to be from the future
    const out  = await getTrainingQueueMetrics({
      queue: makeQueue({ counts: { waiting: 1 }, waitingHead: head }),
      now,
    })
    expect(out.oldestWaitingAgeMs).toBe(0)
  })
})
