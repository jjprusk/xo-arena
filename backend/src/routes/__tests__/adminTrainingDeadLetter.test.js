// Copyright © 2026 Joe Pruskowski. All rights reserved.
//
// A3b.4 — GET /api/v1/admin/training/dead-letter contract.
//
// The endpoint hits BullMQ's `getFailed` and enriches each failed
// training:start job with the matching TrainingSession summary. We
// mock both ends so the test runs without Redis or a live DB.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth:  (req, _res, next) => { req.auth = { userId: 'ba_admin_1' }; next() },
  requireAdmin: (_req, _res, next) => next(),
}))

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { mockGetFailed, mockSessionFindMany } = vi.hoisted(() => ({
  mockGetFailed:       vi.fn(),
  mockSessionFindMany: vi.fn(),
}))

vi.mock('../../queue/trainingQueue.js', () => ({
  getTrainingQueue:    () => ({ getFailed: mockGetFailed }),
  enqueueTrainingStart: vi.fn(),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    trainingSession: { findMany: mockSessionFindMany },
    // Other tables on db.* exist on the real client; admin.js touches several
    // unrelated ones at boot via static imports. Stub the surface the DL
    // handler hits and leave the rest as no-ops via Proxy fallback.
  },
}))

vi.mock('../../services/skillService.js', () => ({
  deleteModel: vi.fn(), getSystemConfig: vi.fn(), setSystemConfig: vi.fn(),
}))

const adminRouter = (await import('../admin.js')).default

const app = express()
app.use(express.json())
app.use('/api/v1/admin', adminRouter)

beforeEach(() => vi.clearAllMocks())

describe('GET /api/v1/admin/training/dead-letter', () => {
  it('returns empty list when the failed set is empty', async () => {
    mockGetFailed.mockResolvedValue([])
    const res = await request(app).get('/api/v1/admin/training/dead-letter')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ count: 0, jobs: [] })
    expect(mockSessionFindMany).not.toHaveBeenCalled()
  })

  it('enriches training:start jobs with the matching TrainingSession summary', async () => {
    mockGetFailed.mockResolvedValue([
      {
        id: 'j1', name: 'training:start',
        data: { sessionId: 'sess_failed' },
        attemptsMade: 3,
        failedReason: 'timeout',
        stacktrace: ['line1', 'line2'],
        finishedOn:  123, processedOn: 100,
      },
      {
        id: 'j2', name: 'ping',
        data: { message: 'hello' },
        attemptsMade: 3,
        failedReason: 'redis disconnect',
        stacktrace: [],
        finishedOn:  200, processedOn: 150,
      },
    ])
    mockSessionFindMany.mockResolvedValue([
      {
        id: 'sess_failed', status: 'FAILED', iterations: 5000,
        summary: { wins: 10, losses: 5 },
        pausedAt: null, checkpointEpisode: 2000,
        model: { id: 'm1', name: 'Q-Bot', algorithm: 'qlearning' },
      },
    ])

    const res = await request(app).get('/api/v1/admin/training/dead-letter')
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(2)
    expect(res.body.jobs[0]).toMatchObject({
      id: 'j1', name: 'training:start',
      attemptsMade: 3,
      failedReason: 'timeout',
      session: { id: 'sess_failed', status: 'FAILED', checkpointEpisode: 2000 },
    })
    // ping jobs have no associated session
    expect(res.body.jobs[1]).toMatchObject({ id: 'j2', name: 'ping', session: null })

    // Only the training:start sessionIds are looked up — ping is skipped.
    expect(mockSessionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['sess_failed'] } },
    }))
  })

  it('respects ?limit= with a hard ceiling of 200', async () => {
    mockGetFailed.mockResolvedValue([])
    await request(app).get('/api/v1/admin/training/dead-letter?limit=5')
    expect(mockGetFailed).toHaveBeenCalledWith(0, 4)

    await request(app).get('/api/v1/admin/training/dead-letter?limit=9999')
    expect(mockGetFailed).toHaveBeenCalledWith(0, 199)
  })

  it('truncates stacktrace to first 3 lines (full trace is bulky and rarely useful in a list view)', async () => {
    mockGetFailed.mockResolvedValue([{
      id: 'j_big', name: 'training:start',
      data: { sessionId: 'no_match' },
      attemptsMade: 3, failedReason: 'oops',
      stacktrace: ['a', 'b', 'c', 'd', 'e'],
    }])
    mockSessionFindMany.mockResolvedValue([])

    const res = await request(app).get('/api/v1/admin/training/dead-letter')
    expect(res.body.jobs[0].stacktrace).toEqual(['a', 'b', 'c'])
  })
})
