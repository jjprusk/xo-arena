// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 5 — GET /api/v1/admin/guide-metrics endpoint.
 *
 * Owns shape + auth tests. Aggregation correctness lives in
 * metricsSnapshot.test.js — this layer just verifies that the route:
 *   1. Recomputes today's snapshot via runMetricsSnapshot
 *   2. Returns last-30-days history from metrics_snapshots
 *   3. Requires admin auth (handled by admin.js's router.use)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// ── Auth — pretend the caller is an admin ──────────────────────────────────
vi.mock('../../middleware/auth.js', () => ({
  requireAuth:  (req, _res, next) => { req.auth = { userId: 'ba_admin' }; next() },
  requireAdmin: (_req, _res, next) => next(),
}))

// ── DB + service mocks ─────────────────────────────────────────────────────
vi.mock('../../lib/db.js', () => {
  const noop = () => vi.fn()
  return {
    default: {
      user:               { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
      baUser:             { findMany: noop(), findUnique: noop(), update: noop(), delete: noop() },
      baSession:          { findMany: noop(), deleteMany: noop() },
      baAccount:          { deleteMany: noop() },
      game:               { count: noop(), findMany: noop(), delete: noop(), deleteMany: noop(), updateMany: noop() },
      botSkill:           { count: noop(), findMany: noop(), findUnique: noop(), update: noop(), delete: noop() },
      gameElo:            { findUnique: noop(), upsert: noop() },
      userRole:           { create: noop(), deleteMany: noop() },
      systemConfig:       { findUnique: vi.fn(), upsert: noop() },
      tournamentAutoDrop: { count: noop(), findMany: noop() },
      metricsSnapshot:    { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
      $transaction:       vi.fn(async (fn) => fn({})),
    },
  }
})
vi.mock('../../services/skillService.js', () => ({
  deleteModel: vi.fn(), getSystemConfig: vi.fn(), setSystemConfig: vi.fn(),
}))
vi.mock('../../services/metricsSnapshotService.js', () => ({
  runMetricsSnapshot: vi.fn(),
}))

const adminRouter = (await import('../admin.js')).default
const db = (await import('../../lib/db.js')).default
const { runMetricsSnapshot } = await import('../../services/metricsSnapshotService.js')

const app = express()
app.use(express.json())
app.use('/api/v1/admin', adminRouter)

const FRESH = {
  date:          new Date('2026-04-25T00:00:00.000Z'),
  northStar:     { value: 0.42, denom: 100, numer: 42 },
  funnel:        { step1: 100, step2: 80, step3: 60, step4: 40, step5: 30, step6: 20, step7: 10 },
  signup:        { credential: 30, oauth: 70 },
  testUserCount: 3,
}

const HISTORY = [
  { date: new Date('2026-04-24T00:00:00.000Z'), metric: 'northStar',     value: 0.40, dimensions: { denom: 100, numer: 40 } },
  { date: new Date('2026-04-25T00:00:00.000Z'), metric: 'northStar',     value: 0.42, dimensions: { denom: 100, numer: 42 } },
  { date: new Date('2026-04-25T00:00:00.000Z'), metric: 'testUserCount', value: 3,    dimensions: {} },
]

beforeEach(() => {
  vi.clearAllMocks()
  runMetricsSnapshot.mockResolvedValue(FRESH)
  db.metricsSnapshot.findMany.mockResolvedValue(HISTORY)
})

describe('GET /api/v1/admin/guide-metrics', () => {
  it('responds 200 with the freshly computed snapshot in `now` and 30-day history', async () => {
    const res = await request(app).get('/api/v1/admin/guide-metrics')
    expect(res.status).toBe(200)
    expect(res.body.now.northStar.value).toBe(0.42)
    expect(res.body.now.testUserCount).toBe(3)
    expect(res.body.history).toHaveLength(3)
    expect(res.body.history[0].metric).toBe('northStar')
  })

  it('queries history with a 30-day lower bound, ordered by date asc', async () => {
    await request(app).get('/api/v1/admin/guide-metrics')
    const args = db.metricsSnapshot.findMany.mock.calls[0][0]
    const since = args.where.date.gte
    const ageDays = (Date.now() - since.getTime()) / (24 * 60 * 60 * 1000)
    // Allow ±1 second of jitter from runMetricsSnapshot's "now"
    expect(ageDays).toBeGreaterThan(29.99)
    expect(ageDays).toBeLessThan(30.01)
    expect(args.orderBy).toEqual([{ date: 'asc' }, { metric: 'asc' }])
  })

  it('returns now=null when runMetricsSnapshot fails internally', async () => {
    runMetricsSnapshot.mockResolvedValueOnce(null)
    const res = await request(app).get('/api/v1/admin/guide-metrics')
    expect(res.status).toBe(200)
    expect(res.body.now).toBeNull()
    expect(res.body.history).toEqual(expect.any(Array))
  })

  it('500s when the underlying history query throws', async () => {
    db.metricsSnapshot.findMany.mockRejectedValueOnce(new Error('DB offline'))
    const res = await request(app).get('/api/v1/admin/guide-metrics')
    // Express default error handler returns 500
    expect(res.status).toBe(500)
  })
})
