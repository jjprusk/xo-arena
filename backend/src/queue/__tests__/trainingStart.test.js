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

  // A3b.4 — register/unregister must wrap the runner so SIGTERM can see
  // every in-flight session, and unregister must still fire if the
  // runner throws (otherwise the shutdown path waits forever on a
  // phantom entry).
  it('registers the session before the runner and unregisters after success', async () => {
    const order = []
    const onStart  = vi.fn(id => order.push(`reg:${id}`))
    const onFinish = vi.fn(id => order.push(`unreg:${id}`))
    const runFn    = vi.fn(async () => { order.push('ran'); return { completed: true } })

    await handleTrainingStart(makeJob({ data: { sessionId: 'sess_lifecycle' } }), { runFn, onStart, onFinish })

    expect(order).toEqual(['reg:sess_lifecycle', 'ran', 'unreg:sess_lifecycle'])
    expect(onStart).toHaveBeenCalledWith('sess_lifecycle')
    expect(onFinish).toHaveBeenCalledWith('sess_lifecycle')
  })

  it('unregisters even when the runner throws — no zombie registry entries', async () => {
    const onStart  = vi.fn()
    const onFinish = vi.fn()
    const runFn    = vi.fn().mockRejectedValue(new Error('runner failed'))

    await expect(
      handleTrainingStart(makeJob({ data: { sessionId: 'sess_throw' } }), { runFn, onStart, onFinish }),
    ).rejects.toThrow('runner failed')

    expect(onStart).toHaveBeenCalledWith('sess_throw')
    expect(onFinish).toHaveBeenCalledWith('sess_throw')
  })
})
