// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * POST /api/v1/admin/dev/flush-notifications — operational drain for
 * the dev/staging notification backlog (added with the redis adapter race
 * fix bundle).
 *
 * Pins the contract:
 *  - marks every undelivered userNotification as deliveredAt=now()
 *  - calls truncateStream(maxLen) with the requested maxLen (default 0)
 *  - returns counts the caller can sanity-check
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth:  (req, _res, next) => { req.auth = { userId: 'ba_admin_1' }; next() },
  requireAdmin: (_req, _res, next) => next(),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    userNotification: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    user:    { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    baUser:  { findMany: vi.fn() },
    game:    { count: vi.fn(), findMany: vi.fn() },
    botSkill: { count: vi.fn() },
  },
}))

vi.mock('../../lib/eventStream.js', () => ({
  truncateStream: vi.fn().mockResolvedValue(0),
}))

vi.mock('../../services/skillService.js', () => ({
  deleteModel: vi.fn(), getSystemConfig: vi.fn(), setSystemConfig: vi.fn(),
}))

vi.mock('../../lib/resourceCounters.js', () => ({
  getSnapshots:         vi.fn(() => []),
  getLatestSnapshot:    vi.fn(),
  getAlerts:            vi.fn(() => ({})),
  getTableCreateErrors: vi.fn(() => ({ P2002: 0, P2003: 0, OTHER: 0 })),
  getGcStats:           vi.fn(() => ({ failures: 0, lastSuccessAt: null, secondsSinceLastSuccess: null })),
  getTableReleased:     vi.fn(() => ({
    disconnect: 0, leave: 0, 'game-end': 0,
    'gc-stale': 0, 'gc-idle': 0, admin: 0, 'guest-cleanup': 0, OTHER: 0,
  })),
}))

const adminRouter = (await import('../admin.js')).default
const db = (await import('../../lib/db.js')).default
const { truncateStream } = await import('../../lib/eventStream.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/admin', adminRouter)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/v1/admin/dev/flush-notifications', () => {
  it('marks undelivered notifications as delivered and wipes the stream by default (maxLen=0)', async () => {
    db.userNotification.updateMany.mockResolvedValue({ count: 235 })
    truncateStream.mockResolvedValue(3697)  // entries removed by XTRIM

    const res = await request(makeApp()).post('/api/v1/admin/dev/flush-notifications')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ok: true,
      notifsMarkedDelivered: 235,
      streamRemaining: 3697,
      streamMaxLenRequested: 0,
    })

    expect(db.userNotification.updateMany).toHaveBeenCalledWith({
      where: { deliveredAt: null },
      data:  expect.objectContaining({ deliveredAt: expect.any(Date) }),
    })
    expect(truncateStream).toHaveBeenCalledWith(0)
  })

  it('honours ?maxLen= so the caller can cap at a soft floor instead of wiping', async () => {
    db.userNotification.updateMany.mockResolvedValue({ count: 0 })
    truncateStream.mockResolvedValue(50)

    const res = await request(makeApp()).post('/api/v1/admin/dev/flush-notifications?maxLen=100')
    expect(res.status).toBe(200)
    expect(res.body.streamMaxLenRequested).toBe(100)
    expect(truncateStream).toHaveBeenCalledWith(100)
  })

  it('clamps a negative maxLen to 0 (no surprise XTRIM with weird args)', async () => {
    db.userNotification.updateMany.mockResolvedValue({ count: 0 })
    truncateStream.mockResolvedValue(0)

    const res = await request(makeApp()).post('/api/v1/admin/dev/flush-notifications?maxLen=-50')
    expect(res.status).toBe(200)
    expect(res.body.streamMaxLenRequested).toBe(0)
    expect(truncateStream).toHaveBeenCalledWith(0)
  })

  it('surfaces the streamRemaining=-1 sentinel when Redis is unavailable', async () => {
    db.userNotification.updateMany.mockResolvedValue({ count: 12 })
    truncateStream.mockResolvedValue(-1)

    const res = await request(makeApp()).post('/api/v1/admin/dev/flush-notifications')
    expect(res.status).toBe(200)
    expect(res.body.streamRemaining).toBe(-1)
    expect(res.body.notifsMarkedDelivered).toBe(12)
  })
})
