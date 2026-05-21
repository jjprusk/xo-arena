// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock BullMQ before importing the module under test. We're not
// exercising real Redis here — what we care about is that the producer
// passes the right job options (attempts + backoff) into queue.add so
// transient failures auto-retry and permanent ones land in failed/DL.

const {
  mockAdd,
  mockClose,
} = vi.hoisted(() => ({
  mockAdd:   vi.fn().mockResolvedValue({ id: 'job_1' }),
  mockClose: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add:   mockAdd,
    close: mockClose,
  })),
}))

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    on:         vi.fn(),
    disconnect: vi.fn(),
  })),
}))

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

process.env.REDIS_URL = 'redis://test:6379'

const { enqueueTrainingStart, _closeTrainingQueueForTests } = await import('../trainingQueue.js')

beforeEach(async () => {
  await _closeTrainingQueueForTests()
  vi.clearAllMocks()
})

describe('enqueueTrainingStart — A3b.4 retry policy', () => {
  it('rejects when sessionId is missing — caller bug, not a transient failure', async () => {
    await expect(enqueueTrainingStart(null)).rejects.toThrow(/sessionId required/)
    await expect(enqueueTrainingStart(undefined)).rejects.toThrow(/sessionId required/)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('adds a training:start job with attempts=3 and exponential backoff', async () => {
    await enqueueTrainingStart('sess_42')

    expect(mockAdd).toHaveBeenCalledTimes(1)
    const [name, data, opts] = mockAdd.mock.calls[0]
    expect(name).toBe('training:start')
    expect(data).toMatchObject({ sessionId: 'sess_42' })
    expect(typeof data.enqueuedAt).toBe('number')
    expect(opts).toMatchObject({
      attempts: 3,
      backoff:  { type: 'exponential', delay: 30_000 },
    })
  })

  it('does not set removeOnFail — permanent failures stay in the failed index for the DL endpoint to read', async () => {
    await enqueueTrainingStart('sess_dl')
    const opts = mockAdd.mock.calls[0][2]
    expect(opts.removeOnFail).toBeUndefined()  // BullMQ default keeps failed jobs
  })
})
