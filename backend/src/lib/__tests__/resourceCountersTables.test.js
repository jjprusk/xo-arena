// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Chunk 2 — table-resource counter tests.
 *
 * Covers the pieces that don't go through the snapshot interval:
 *  - getGcStats / record/increment helpers
 *  - getTableCreateErrors snapshot shape
 *
 * The snapshot loop itself (alert flips, per-mode breakdown) is exercised
 * end-to-end via the /health/tables route test (adminHealthTables.test.js)
 * and by the tableGcService test that asserts a failed sweep increments
 * the counter.
 */

import { describe, it, expect } from 'vitest'

const counters = await import('../resourceCounters.js')

describe('table-create error counter', () => {
  it('exposes the three buckets', () => {
    const snap = counters.getTableCreateErrors()
    expect(snap).toHaveProperty('P2002')
    expect(snap).toHaveProperty('P2003')
    expect(snap).toHaveProperty('OTHER')
  })
})

describe('gc liveness counter', () => {
  it('starts with no recorded success', () => {
    // Note: this is module-scoped state, so other tests in the same vitest
    // run will have already touched it. We only assert the shape here.
    const stats = counters.getGcStats()
    expect(stats).toHaveProperty('failures')
    expect(stats).toHaveProperty('lastSuccessAt')
    expect(stats).toHaveProperty('secondsSinceLastSuccess')
  })

  it('recordGcSuccess sets lastSuccessAt to now and clears the staleness reading', () => {
    counters.recordGcSuccess()
    const stats = counters.getGcStats()
    expect(typeof stats.lastSuccessAt).toBe('number')
    expect(stats.secondsSinceLastSuccess).toBeGreaterThanOrEqual(0)
    expect(stats.secondsSinceLastSuccess).toBeLessThan(5)
  })

  it('incrementGcFailure bumps the failure counter monotonically', () => {
    const start = counters.getGcStats().failures
    counters.incrementGcFailure()
    counters.incrementGcFailure()
    expect(counters.getGcStats().failures).toBe(start + 2)
  })
})

// Chunk 3 F7 — table.released per-reason counter.
describe('table-released counter', () => {
  it('exposes a bucket per known reason plus an OTHER catch-all', () => {
    const snap = counters.getTableReleased()
    for (const reason of [
      'disconnect', 'leave', 'game-end',
      'gc-stale', 'gc-idle', 'admin', 'guest-cleanup',
      'OTHER',
    ]) {
      expect(snap).toHaveProperty(reason)
    }
  })

  it('incrementTableReleased bumps the matching bucket and lands typos in OTHER', () => {
    const start = counters.getTableReleased()
    counters.incrementTableReleased('disconnect')
    counters.incrementTableReleased('disconnect')
    counters.incrementTableReleased('definitely-not-a-reason')
    const after = counters.getTableReleased()
    expect(after.disconnect).toBe(start.disconnect + 2)
    expect(after.OTHER).toBe(start.OTHER + 1)
  })

  it('returns a copy, not the live object — caller cannot mutate state', () => {
    const snap = counters.getTableReleased()
    snap.disconnect = 999_999
    expect(counters.getTableReleased().disconnect).not.toBe(999_999)
  })
})
