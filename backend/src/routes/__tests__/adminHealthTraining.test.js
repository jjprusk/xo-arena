// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.5 — GET /api/v1/admin/health/training surfaces the latest
 * trainingHealthMonitor snapshot + current alert flags. We mock the
 * monitor module so the test never touches Redis or BullMQ.
 */
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

const { mockGetSnapshot, mockGetAlerts } = vi.hoisted(() => ({
  mockGetSnapshot: vi.fn(),
  mockGetAlerts:   vi.fn(),
}))

vi.mock('../../queue/trainingHealthMonitor.js', () => ({
  getTrainingHealthSnapshot: mockGetSnapshot,
  getTrainingHealthAlerts:   mockGetAlerts,
}))

vi.mock('../../services/skillService.js', () => ({
  deleteModel: vi.fn(), getSystemConfig: vi.fn(), setSystemConfig: vi.fn(),
}))

const adminRouter = (await import('../admin.js')).default

const app = express()
app.use(express.json())
app.use('/api/v1/admin', adminRouter)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAlerts.mockReturnValue({ queueStalled: false, deadLetter: false })
})

describe('GET /api/v1/admin/health/training', () => {
  it('returns latest:null when the monitor has not produced a snapshot yet', async () => {
    mockGetSnapshot.mockReturnValue(null)
    const res = await request(app).get('/api/v1/admin/health/training')
    expect(res.status).toBe(200)
    expect(res.body.latest).toBeNull()
    expect(res.body.alerts).toEqual({ queueStalled: false, deadLetter: false })
    expect(typeof res.body.uptime).toBe('number')
  })

  it('surfaces a full snapshot — queue metrics + worker samples + alert flags', async () => {
    mockGetSnapshot.mockReturnValue({
      ts: 12345,
      queue: { waiting: 2, active: 1, failed: 0, oldestWaitingAgeMs: 30_000 },
      workers: [
        { workerId: 'worker-1:42', cpuPct: 14, rssMb: 90, activeSessions: 1 },
        { workerId: 'worker-2:43', cpuPct:  3, rssMb: 75, activeSessions: 0 },
      ],
      alerts: { queueStalled: false, deadLetter: false },
      thresholds: { queueWaitingThreshold: 1, queueAgeThresholdMs: 300000 },
    })
    mockGetAlerts.mockReturnValue({ queueStalled: false, deadLetter: false })

    const res = await request(app).get('/api/v1/admin/health/training')
    expect(res.status).toBe(200)
    expect(res.body.latest.queue.waiting).toBe(2)
    expect(res.body.latest.workers).toHaveLength(2)
    expect(res.body.latest.workers[0].workerId).toBe('worker-1:42')
  })

  it('reflects raised alerts in the response when the monitor reports them', async () => {
    mockGetSnapshot.mockReturnValue({
      ts: 1, queue: { waiting: 5, failed: 1, oldestWaitingAgeMs: 400_000 },
      workers: [], alerts: { queueStalled: true, deadLetter: true },
      thresholds: { queueWaitingThreshold: 1, queueAgeThresholdMs: 300000 },
    })
    mockGetAlerts.mockReturnValue({ queueStalled: true, deadLetter: true })

    const res = await request(app).get('/api/v1/admin/health/training')
    expect(res.status).toBe(200)
    expect(res.body.alerts).toEqual({ queueStalled: true, deadLetter: true })
  })
})
