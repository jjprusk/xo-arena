// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, vi } from 'vitest'
import { handleTrainingStart } from '../jobs/trainingStart.js'

// Unit-test the handler with the runner injected — no Prisma, no
// BullMQ instance. The worker bootstrap (worker.js) supplies the real
// `_runTrainingForQueueJob` from mlService.js; here we just prove the
// glue: payload validation, runner invocation, result shape.

function makeJob({ id = 'job_1', name = 'training:start', data = {} } = {}) {
  return { id, name, data }
}

describe('handleTrainingStart', () => {
  it('invokes the runner with the session id and returns its result + timing', async () => {
    const runFn = vi.fn().mockResolvedValue({ completed: true, resumedFrom: 0 })
    const job   = makeJob({ data: { sessionId: 'sess_42', enqueuedAt: Date.now() - 25 } })

    const out = await handleTrainingStart(job, { runFn })

    expect(runFn).toHaveBeenCalledTimes(1)
    expect(runFn).toHaveBeenCalledWith('sess_42')
    expect(out).toMatchObject({ ok: true, sessionId: 'sess_42', completed: true, resumedFrom: 0 })
    expect(typeof out.durationMs).toBe('number')
    expect(out.lagMs).toBeGreaterThanOrEqual(25)
  })

  it('reports lagMs=null when caller did not stamp enqueuedAt', async () => {
    const runFn = vi.fn().mockResolvedValue({ completed: true })
    const job   = makeJob({ data: { sessionId: 'sess_x' } })

    const out = await handleTrainingStart(job, { runFn })

    expect(out.lagMs).toBeNull()
    expect(out.ok).toBe(true)
  })

  it('throws when sessionId is missing — never silently no-ops', async () => {
    const runFn = vi.fn()
    await expect(handleTrainingStart(makeJob({ data: {} }), { runFn }))
      .rejects.toThrow(/missing sessionId/)
    expect(runFn).not.toHaveBeenCalled()
  })

  it('propagates runner failures so BullMQ marks the job failed', async () => {
    const runFn = vi.fn().mockRejectedValue(new Error('boom'))
    const job   = makeJob({ data: { sessionId: 'sess_err' } })
    await expect(handleTrainingStart(job, { runFn })).rejects.toThrow('boom')
  })
})
