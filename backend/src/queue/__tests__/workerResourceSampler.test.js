// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.5 — workerResourceSampler covers the pure sample shape (no
 * I/O), the delta math, and the Redis write contract.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  captureWorkerSample,
  startWorkerResourceSampler,
  WORKER_METRICS_KEY_PREFIX,
  WORKER_METRICS_TTL_S,
} from '../workerResourceSampler.js'

describe('captureWorkerSample', () => {
  it('reports null deltas on the first sample (no previous to compare against)', () => {
    const sample = captureWorkerSample({
      prev: null,
      now:  1_000,
      resourceUsage: { userCPUTime: 500_000, systemCPUTime: 100_000 },
      memoryUsage:   { rss: 80 * 1024 * 1024, heapUsed: 30 * 1024 * 1024, heapTotal: 50 * 1024 * 1024, external: 5 * 1024 * 1024 },
      uptimeSec: 10,
      activeSessions: 2,
    })
    expect(sample).toMatchObject({
      ts: 1_000,
      uptimeSec: 10,
      rssMb: 80, heapUsedMb: 30, heapTotalMb: 50, externalMb: 5,
      userCpuUs: 500_000, sysCpuUs: 100_000,
      userCpuDeltaUs: null, sysCpuDeltaUs: null, wallDeltaMs: null,
      cpuPct: null, activeSessions: 2,
    })
  })

  it('computes CPU% from user+sys CPU delta divided by wall delta', () => {
    const prev = {
      ts: 1_000, userCpuUs: 0, sysCpuUs: 0,
    }
    // 500ms wall elapsed; 250ms CPU consumed (user) + 50ms (sys) = 300ms / 500ms = 60%
    const sample = captureWorkerSample({
      prev,
      now:  1_500,
      resourceUsage: { userCPUTime: 250_000, systemCPUTime: 50_000 },
      memoryUsage:   { rss: 0, heapUsed: 0, heapTotal: 0, external: 0 },
    })
    expect(sample.wallDeltaMs).toBe(500)
    expect(sample.userCpuDeltaUs).toBe(250_000)
    expect(sample.sysCpuDeltaUs).toBe(50_000)
    expect(sample.cpuPct).toBe(60)
  })

  it('clamps negative CPU deltas to 0 (process counters never go backwards but be defensive)', () => {
    const prev = { ts: 0, userCpuUs: 1_000_000, sysCpuUs: 1_000_000 }
    const sample = captureWorkerSample({
      prev,
      now: 1_000,
      resourceUsage: { userCPUTime: 500_000, systemCPUTime: 500_000 }, // appears to have gone down
      memoryUsage:   { rss: 0, heapUsed: 0, heapTotal: 0, external: 0 },
    })
    expect(sample.userCpuDeltaUs).toBe(0)
    expect(sample.sysCpuDeltaUs).toBe(0)
    expect(sample.cpuPct).toBe(0)
  })
})

describe('startWorkerResourceSampler', () => {
  it('writes a sample to Redis under the prefixed key with TTL', async () => {
    const redis = {
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    }
    const stop = startWorkerResourceSampler({
      redis,
      workerId:   'host:42',
      intervalMs: 60_000_000, // effectively never auto-ticks during the test
      getActiveCount: () => 3,
    })
    // The immediate tick is fire-and-forget; await a microtask flush
    // by yielding once via Promise.resolve().
    await new Promise(r => setImmediate(r))
    expect(redis.set).toHaveBeenCalledTimes(1)
    const [key, value, mode, ttl] = redis.set.mock.calls[0]
    expect(key).toBe(`${WORKER_METRICS_KEY_PREFIX}host:42`)
    expect(mode).toBe('EX')
    expect(ttl).toBe(WORKER_METRICS_TTL_S)
    const parsed = JSON.parse(value)
    expect(parsed).toMatchObject({ workerId: 'host:42', activeSessions: 3 })

    await stop()
    expect(redis.del).toHaveBeenCalledWith(`${WORKER_METRICS_KEY_PREFIX}host:42`)
  })

  it('rejects when no redis client is provided', () => {
    expect(() => startWorkerResourceSampler({})).toThrow(/redis client required/)
  })
})
