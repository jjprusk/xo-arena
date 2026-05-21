// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.5 — trainingHealthMonitor covers:
 *   - alert-edge dispatch (no spam when state is unchanged)
 *   - queueStalled requires BOTH waiting>=N AND ageMs>=threshold
 *   - deadLetter fires the moment failed >= 1
 *   - cleared notifications dispatch when alerts flip off
 *   - graceful failure when queue metrics throw
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const {
  evaluateTrainingHealth,
  getTrainingHealthSnapshot,
  getTrainingHealthAlerts,
  _resetTrainingHealthForTests,
} = await import('../trainingHealthMonitor.js')

beforeEach(() => {
  _resetTrainingHealthForTests()
  vi.clearAllMocks()
})

function makeOpts({ queue, samples = [], dispatch, getAdminIds, thresholds = {} } = {}) {
  return {
    redis:           { mock: true },
    getQueueMetrics: vi.fn().mockResolvedValue(queue),
    readSamples:    vi.fn().mockResolvedValue(samples),
    dispatch:       dispatch ?? vi.fn().mockResolvedValue(undefined),
    getAdminIds:    getAdminIds ?? vi.fn().mockResolvedValue(['u_admin_1']),
    thresholds,
    now: 1_000_000,
  }
}

describe('evaluateTrainingHealth', () => {
  it('returns a snapshot with queue + workers + cleared alerts on a healthy state', async () => {
    const opts = makeOpts({
      queue:   { waiting: 0, active: 1, failed: 0, oldestWaitingAgeMs: null },
      samples: [{ workerId: 'w1', cpuPct: 12, rssMb: 90 }],
    })
    const snap = await evaluateTrainingHealth(opts)

    expect(snap.queue.waiting).toBe(0)
    expect(snap.workers).toHaveLength(1)
    expect(snap.alerts).toEqual({ queueStalled: false, deadLetter: false })
    expect(opts.dispatch).not.toHaveBeenCalled()
    expect(getTrainingHealthSnapshot()).toBe(snap)
  })

  it('does NOT fire queueStalled when only waiting is high but age is short', async () => {
    const opts = makeOpts({
      queue: { waiting: 5, active: 0, failed: 0, oldestWaitingAgeMs: 60_000 },
    })
    const snap = await evaluateTrainingHealth(opts)
    expect(snap.alerts.queueStalled).toBe(false)
    expect(opts.dispatch).not.toHaveBeenCalled()
  })

  it('fires queueStalled when waiting>=N AND age>=5min — edge transition only', async () => {
    const opts = makeOpts({
      queue: { waiting: 3, active: 0, failed: 0, oldestWaitingAgeMs: 6 * 60 * 1000 },
    })
    await evaluateTrainingHealth(opts)
    expect(opts.dispatch).toHaveBeenCalledTimes(1)
    expect(opts.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type:    'system.alert',
      targets: { cohort: ['u_admin_1'] },
      payload: expect.objectContaining({ key: 'queueStalled', source: 'training' }),
    }))

    // Second tick with the same state must NOT re-dispatch.
    await evaluateTrainingHealth(opts)
    expect(opts.dispatch).toHaveBeenCalledTimes(1)
  })

  it('fires deadLetter alert when failed >= 1 and clears it when drained', async () => {
    const dispatch = vi.fn().mockResolvedValue()

    // Tick 1: failed=2 → alert raised
    await evaluateTrainingHealth(makeOpts({
      queue: { waiting: 0, failed: 2, oldestWaitingAgeMs: null },
      dispatch,
    }))
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0][0].type).toBe('system.alert')
    expect(dispatch.mock.calls[0][0].payload.key).toBe('deadLetter')

    // Tick 2: failed=0 → cleared
    await evaluateTrainingHealth(makeOpts({
      queue: { waiting: 0, failed: 0, oldestWaitingAgeMs: null },
      dispatch,
    }))
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch.mock.calls[1][0].type).toBe('system.alert.cleared')
    expect(dispatch.mock.calls[1][0].payload.key).toBe('deadLetter')
    expect(getTrainingHealthAlerts().deadLetter).toBe(false)
  })

  it('skips dispatch when there are no admins to notify', async () => {
    const dispatch    = vi.fn()
    const getAdminIds = vi.fn().mockResolvedValue([]) // no admins seeded yet
    await evaluateTrainingHealth(makeOpts({
      queue: { waiting: 0, failed: 5, oldestWaitingAgeMs: null },
      dispatch, getAdminIds,
    }))
    expect(getAdminIds).toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    // Alert state still flipped — next tick won't re-fetch the empty list endlessly.
    expect(getTrainingHealthAlerts().deadLetter).toBe(true)
  })

  it('returns a degraded snapshot when getQueueMetrics throws', async () => {
    const opts = {
      redis: {},
      getQueueMetrics: vi.fn().mockRejectedValue(new Error('redis down')),
      readSamples:     vi.fn().mockResolvedValue([]),
      dispatch:        vi.fn(),
      getAdminIds:     vi.fn(),
      now: 5,
    }
    const snap = await evaluateTrainingHealth(opts)
    expect(snap.queue).toBeNull()
    expect(snap.ts).toBe(5)
    expect(opts.dispatch).not.toHaveBeenCalled()
  })

  it('honors per-call thresholds (admin-tunable override of the 5-minute default)', async () => {
    const opts = makeOpts({
      queue:      { waiting: 1, failed: 0, oldestWaitingAgeMs: 10_000 },
      thresholds: { queueWaitingThreshold: 1, queueAgeThresholdMs: 5_000 }, // 5s threshold
    })
    const snap = await evaluateTrainingHealth(opts)
    expect(snap.alerts.queueStalled).toBe(true)
    expect(opts.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'system.alert' }))
  })
})
