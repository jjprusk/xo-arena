// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, vi } from 'vitest'
import { readWorkerOptions, _DEFAULTS_FOR_TESTS } from '../workerOptions.js'

// readWorkerOptions is a thin pure function over the SystemConfig
// getter — the value of testing it is pinning the defaults + the
// "garbage → fallback" path so a typo'd SystemConfig row can't ship
// `concurrency: NaN` to BullMQ and silently jam the worker.

function makeGetter(map) {
  return (key, fallback) => Promise.resolve(map[key] ?? fallback)
}

describe('readWorkerOptions (A3b.3)', () => {
  it('returns the documented defaults when SystemConfig is empty', async () => {
    const out = await readWorkerOptions({ getConfig: makeGetter({}) })
    expect(out).toEqual({
      concurrency: _DEFAULTS_FOR_TESTS.concurrency,
      limiter:     { max: _DEFAULTS_FOR_TESTS.jobsPerSecond, duration: 1000 },
    })
  })

  it('honors explicit SystemConfig values', async () => {
    const out = await readWorkerOptions({
      getConfig: makeGetter({
        'ml.workerConcurrency':   5,
        'ml.workerJobsPerSecond': 10,
      }),
    })
    expect(out).toEqual({
      concurrency: 5,
      limiter:     { max: 10, duration: 1000 },
    })
  })

  it('coerces stringified numbers (SystemConfig JSON column can store strings)', async () => {
    const out = await readWorkerOptions({
      getConfig: makeGetter({
        'ml.workerConcurrency':   '3',
        'ml.workerJobsPerSecond': '8',
      }),
    })
    expect(out.concurrency).toBe(3)
    expect(out.limiter.max).toBe(8)
  })

  it('falls back to defaults for non-numeric values (never hands NaN to BullMQ)', async () => {
    const out = await readWorkerOptions({
      getConfig: makeGetter({
        'ml.workerConcurrency':   'not-a-number',
        'ml.workerJobsPerSecond': null,
      }),
    })
    expect(out.concurrency).toBe(_DEFAULTS_FOR_TESTS.concurrency)
    expect(out.limiter.max).toBe(_DEFAULTS_FOR_TESTS.jobsPerSecond)
  })

  it('clamps zero / negative concurrency to at least 1 — a zero-concurrency worker would silently jam', async () => {
    const out = await readWorkerOptions({
      getConfig: makeGetter({
        'ml.workerConcurrency':   0,
        'ml.workerJobsPerSecond': -5,
      }),
    })
    expect(out.concurrency).toBe(_DEFAULTS_FOR_TESTS.concurrency)
    expect(out.limiter.max).toBe(_DEFAULTS_FOR_TESTS.jobsPerSecond)
  })

  it('reads both keys via the injected getter (not via implicit imports)', async () => {
    const getter = vi.fn().mockImplementation(makeGetter({}))
    await readWorkerOptions({ getConfig: getter })
    expect(getter).toHaveBeenCalledTimes(2)
    const calledKeys = getter.mock.calls.map(c => c[0]).sort()
    expect(calledKeys).toEqual(['ml.workerConcurrency', 'ml.workerJobsPerSecond'])
  })
})
