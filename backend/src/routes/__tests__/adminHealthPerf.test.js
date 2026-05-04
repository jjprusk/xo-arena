// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * GET /api/v1/admin/health/perf/vitals — RUM aggregation endpoint.
 *
 * Auth-gated by requireAuth + requireAdmin (mocked here to admit). The
 * Postgres percentile_cont aggregation is a raw-SQL call, so the test
 * mocks `db.$queryRaw` directly and asserts the route reshapes the rows
 * into the documented per-route / per-metric structure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth:  (req, _res, next) => { req.auth = { userId: 'ba_admin_1' }; next() },
  requireAdmin: (_req, _res, next) => next(),
}))

vi.mock('../../lib/resourceCounters.js', () => ({
  getSnapshots:         vi.fn(() => []),
  getLatestSnapshot:    vi.fn(() => null),
  getAlerts:            vi.fn(() => ({})),
  getTableCreateErrors: vi.fn(() => ({ P2002: 0, P2003: 0, OTHER: 0 })),
  getGcStats:           vi.fn(() => ({ failures: 0, lastSuccessAt: null, secondsSinceLastSuccess: null })),
  getTableReleased:     vi.fn(() => ({})),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    user:    { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    baUser:  { findMany: vi.fn() },
    game:    { count: vi.fn(), findMany: vi.fn() },
    botSkill: { count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

vi.mock('../../services/skillService.js', () => ({
  deleteModel: vi.fn(), getSystemConfig: vi.fn(), setSystemConfig: vi.fn(),
}))

const adminRouter = (await import('../admin.js')).default
const db          = (await import('../../lib/db.js')).default

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/admin', adminRouter)
  return app
}

const aggRows = [
  { route: '/',         name: 'FCP',  cnt: 100, p50: 612.3, p75: 980,  p95: 1812, good: 90, needs: 8, poor: 2 },
  { route: '/',         name: 'LCP',  cnt: 100, p50: 1240,  p75: 1800, p95: 2620, good: 80, needs: 15, poor: 5 },
  { route: '/play',     name: 'INP',  cnt: 50,  p50: 88,    p75: 140,  p95: 240,  good: 45, needs: 4,  poor: 1 },
  { route: '/rankings', name: 'TTFB', cnt: 30,  p50: 188,   p75: 260,  p95: 540,  good: 28, needs: 2,  poor: 0 },
]
const envRows = [
  { env: 'local',   cnt: 12 },
  { env: 'staging', cnt: 87 },
  { env: 'prod',    cnt: 940 },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/admin/health/perf/vitals', () => {
  it('aggregates rows into per-route / per-metric percentiles + rating buckets', async () => {
    db.$queryRaw
      .mockResolvedValueOnce(aggRows)   // first query → percentiles
      .mockResolvedValueOnce(envRows)   // second query → env counts

    const res = await request(makeApp()).get('/api/v1/admin/health/perf/vitals')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      window:    '24h',
      env:       null,
      totalRows: 12 + 87 + 940,
      byEnv:     { local: 12, staging: 87, prod: 940 },
    })
    expect(typeof res.body.since).toBe('string')

    const byRoute = Object.fromEntries(res.body.routes.map(r => [r.route, r.metrics]))
    expect(byRoute['/'].FCP).toMatchObject({
      count: 100, p50: 612.3, p75: 980, p95: 1812, good: 90, needs: 8, poor: 2,
    })
    expect(byRoute['/'].LCP.p95).toBe(2620)
    expect(byRoute['/play'].INP.count).toBe(50)
    expect(byRoute['/rankings'].TTFB.poor).toBe(0)
  })

  it('defaults the window to 24h when an unknown value is supplied', async () => {
    db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const res = await request(makeApp()).get('/api/v1/admin/health/perf/vitals?window=42m')

    expect(res.status).toBe(200)
    expect(res.body.window).toBe('24h')
    expect(res.body.totalRows).toBe(0)
    expect(res.body.routes).toEqual([])
  })

  it('honors the 7d window', async () => {
    db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const res = await request(makeApp()).get('/api/v1/admin/health/perf/vitals?window=7d')
    expect(res.status).toBe(200)
    expect(res.body.window).toBe('7d')
  })

  it('echoes the env filter when supplied', async () => {
    db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const res = await request(makeApp()).get('/api/v1/admin/health/perf/vitals?env=prod')
    expect(res.status).toBe(200)
    expect(res.body.env).toBe('prod')
  })

  it('returns 500 when the underlying query throws', async () => {
    db.$queryRaw.mockRejectedValueOnce(new Error('connection refused'))
    const res = await request(makeApp()).get('/api/v1/admin/health/perf/vitals')
    expect(res.status).toBe(500)
  })

  it('handles null percentile values gracefully (no rows in a bucket)', async () => {
    db.$queryRaw
      .mockResolvedValueOnce([
        { route: '/empty', name: 'CLS', cnt: 0, p50: null, p75: null, p95: null, good: 0, needs: 0, poor: 0 },
      ])
      .mockResolvedValueOnce([])
    const res = await request(makeApp()).get('/api/v1/admin/health/perf/vitals')
    expect(res.status).toBe(200)
    const empty = res.body.routes.find(r => r.route === '/empty')
    expect(empty.metrics.CLS).toMatchObject({ count: 0, p50: null, p75: null, p95: null })
  })
})
