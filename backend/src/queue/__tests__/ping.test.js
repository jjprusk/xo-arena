// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, vi } from 'vitest'
import { handlePing } from '../jobs/ping.js'

// Unit-test the handler in isolation — no Redis, no BullMQ instance.
// The worker bootstrap (worker.js) is just wiring; what matters is that
// each handler is a pure function over a Job-shaped argument.

function makeJob({ id = 'job_1', name = 'ping', data = {} } = {}) {
  return { id, name, data }
}

describe('handlePing', () => {
  it('returns ok=true with the original message + receivedAt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-21T16:00:00.000Z'))
    const job = makeJob({ data: { message: 'hello', enqueuedAt: Date.now() } })

    const out = await handlePing(job)

    expect(out).toMatchObject({ ok: true, message: 'hello' })
    expect(out.receivedAt).toBe(Date.now())
    expect(out.lagMs).toBe(0)
    vi.useRealTimers()
  })

  it('reports queue-lag (now - enqueuedAt) when caller stamps enqueuedAt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-21T16:00:00.500Z'))
    const job = makeJob({ data: { message: 'lagged', enqueuedAt: Date.now() - 500 } })

    const out = await handlePing(job)

    expect(out.lagMs).toBe(500)
    vi.useRealTimers()
  })

  it('handles missing payload gracefully (null message, null lag)', async () => {
    const out = await handlePing(makeJob({ data: undefined }))
    expect(out).toMatchObject({ ok: true, message: null, lagMs: null })
    expect(typeof out.receivedAt).toBe('number')
  })
})
