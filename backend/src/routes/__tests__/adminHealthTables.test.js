// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * GET /api/v1/admin/health/tables — chunk 2 instrumentation endpoint.
 *
 * Auth-gated by requireAuth + requireAdmin (mocked here to admit). The
 * counter helpers are mocked to predictable values; the test asserts
 * that the route shape doesn't drift.
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
  getLatestSnapshot:    vi.fn(),
  getAlerts:            vi.fn(() => ({})),
  getTableCreateErrors: vi.fn(() => ({ P2002: 0, P2003: 0, OTHER: 0 })),
  getGcStats:           vi.fn(() => ({ failures: 0, lastSuccessAt: null, secondsSinceLastSuccess: null })),
  getTableReleased:     vi.fn(() => ({
    disconnect: 0, leave: 0, 'game-end': 0,
    'gc-stale': 0, 'gc-idle': 0, admin: 0, 'guest-cleanup': 0,
    OTHER: 0,
  })),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    user:    { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    baUser:  { findMany: vi.fn() },
    game:    { count: vi.fn(), findMany: vi.fn() },
    botSkill: { count: vi.fn() },
  },
}))

vi.mock('../../services/skillService.js', () => ({
  deleteModel: vi.fn(), getSystemConfig: vi.fn(), setSystemConfig: vi.fn(),
}))

const adminRouter = (await import('../admin.js')).default
const counters = await import('../../lib/resourceCounters.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/admin', adminRouter)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  counters.getLatestSnapshot.mockReturnValue(null)
  counters.getAlerts.mockReturnValue({})
  counters.getTableCreateErrors.mockReturnValue({ P2002: 0, P2003: 0, OTHER: 0 })
  counters.getGcStats.mockReturnValue({ failures: 0, lastSuccessAt: null, secondsSinceLastSuccess: null })
  counters.getTableReleased.mockReturnValue({
    disconnect: 0, leave: 0, 'game-end': 0,
    'gc-stale': 0, 'gc-idle': 0, admin: 0, 'guest-cleanup': 0,
    OTHER: 0,
  })
})

describe('GET /api/v1/admin/health/tables', () => {
  it('returns the documented shape with zero values when no snapshot has been taken', async () => {
    const res = await request(makeApp()).get('/api/v1/admin/health/tables')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      latest: {
        ts:                       null,
        tablesForming:            0,
        tablesActive:             0,
        tablesCompleted:          0,
        tablesStaleForming:       0,
        tablesActive_pvp:         0,
        tablesActive_hvb:         0,
        tablesActive_tournament:  0,
        tablesActive_demo:        0,
        tableWatchers:            0,
      },
      alerts: {
        tablesActive:       false,
        tablesStaleForming: false,
        gcStale:            false,
      },
      tableCreateErrors: { P2002: 0, P2003: 0, OTHER: 0 },
      tableReleased: {
        disconnect: 0, leave: 0, 'game-end': 0,
        'gc-stale': 0, 'gc-idle': 0, admin: 0, 'guest-cleanup': 0,
        OTHER: 0,
      },
      gc: { failures: 0, lastSuccessAt: null, secondsSinceLastSuccess: null },
    })
    // socketAdapter reports the realtime transport. Phase 8 cut socket.io;
    // the only legal value is now 'sse'.
    expect(res.body.socketAdapter).toBe('sse')
    expect(typeof res.body.uptime).toBe('number')
  })

  it('passes through populated table-released counts (chunk 3 F7)', async () => {
    counters.getTableReleased.mockReturnValue({
      disconnect: 14, leave: 7, 'game-end': 200,
      'gc-stale': 3, 'gc-idle': 1, admin: 2, 'guest-cleanup': 18,
      OTHER: 0,
    })
    const res = await request(makeApp()).get('/api/v1/admin/health/tables')
    expect(res.status).toBe(200)
    expect(res.body.tableReleased).toEqual({
      disconnect: 14, leave: 7, 'game-end': 200,
      'gc-stale': 3, 'gc-idle': 1, admin: 2, 'guest-cleanup': 18,
      OTHER: 0,
    })
  })

  it('passes through per-mode active counts and table-create errors when populated', async () => {
    counters.getLatestSnapshot.mockReturnValue({
      ts:                      1234567890,
      tablesForming:           4,
      tablesActive:            10,
      tablesCompleted:         99,
      tablesStaleForming:      2,
      tablesActive_pvp:        3,
      tablesActive_hvb:        4,
      tablesActive_tournament: 2,
      tablesActive_demo:       1,
      tableWatchers:           7,
    })
    counters.getTableCreateErrors.mockReturnValue({ P2002: 5, P2003: 0, OTHER: 1 })
    counters.getGcStats.mockReturnValue({ failures: 2, lastSuccessAt: 1700000000000, secondsSinceLastSuccess: 12 })
    counters.getAlerts.mockReturnValue({ tablesStaleForming: true })

    const res = await request(makeApp()).get('/api/v1/admin/health/tables')
    expect(res.status).toBe(200)
    expect(res.body.latest.tablesActive_hvb).toBe(4)
    expect(res.body.latest.tablesActive_pvp).toBe(3)
    expect(res.body.tableCreateErrors).toEqual({ P2002: 5, P2003: 0, OTHER: 1 })
    expect(res.body.gc).toEqual({ failures: 2, lastSuccessAt: 1700000000000, secondsSinceLastSuccess: 12 })
    expect(res.body.alerts.tablesStaleForming).toBe(true)
    expect(res.body.alerts.gcStale).toBe(false)
  })
})
