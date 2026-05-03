// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.auth = { userId: 'ba_user_1' }; next() },
  optionalAuth: (req, _res, next) => { req.auth = { userId: 'ba_user_1' }; next() },
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    user:  { findUnique: vi.fn() },
    table: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
}))
vi.mock('../../services/skillService.js', () => ({
  getSystemConfig: vi.fn(async (_k, dflt) => dflt),
}))
vi.mock('../../services/tableService.js', () => ({ handleIdlePong: vi.fn() }))
vi.mock('../../services/tournamentMatchService.js', () => ({
  joinMatchTable: vi.fn(),
  TournamentMatchError: class extends Error { constructor(c, m) { super(m ?? c); this.code = c } },
}))

const flow = vi.hoisted(() => ({
  createPvpTable: vi.fn(), createHvbTable: vi.fn(), joinTable: vi.fn(),
  cancelTable: vi.fn(), applyMove: vi.fn(), forfeitGame: vi.fn(),
  leaveGame: vi.fn(), rematchGame: vi.fn(), sendReaction: vi.fn(),
}))
vi.mock('../../services/tableFlowService.js', () => flow)

vi.mock('../../lib/eventStream.js', () => ({ appendToStream: vi.fn().mockResolvedValue('1-0') }))
vi.mock('../../realtime/socketHandler.js', () => ({ dispatchBotMove: vi.fn() }))
vi.mock('../../logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import db from '../../lib/db.js'
import * as sseSessions from '../../realtime/sseSessions.js'
import realtimeRouter from '../realtime.js'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.set('io', { to: vi.fn().mockReturnThis(), emit: vi.fn() })
  app.use('/api/v1/rt', realtimeRouter)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  sseSessions._resetForTests()
  sseSessions.register('s1', { userId: 'user_1' })
  db.user.findUnique.mockResolvedValue({
    id: 'user_1', betterAuthId: 'ba_user_1', displayName: 'A',
  })
})

describe('POST /api/v1/rt/tables/:slug/rematch', () => {
  it('forwards rematch to the service and returns round + scores', async () => {
    const app = makeApp()
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.rematchGame.mockResolvedValueOnce({
      ok: true,
      table: { id: 'tbl_1' },
      previewState: { round: 2, scores: { X: 1, O: 0 } },
    })

    const res = await request(app)
      .post('/api/v1/rt/tables/abc/rematch')
      .set('X-SSE-Session', 's1')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, round: 2, scores: { X: 1, O: 0 } })
    expect(flow.rematchGame).toHaveBeenCalledWith(expect.objectContaining({ tableId: 'tbl_1' }))
  })

  it('404s when the table does not exist', async () => {
    const app = makeApp()
    db.table.findFirst.mockResolvedValueOnce(null)
    const res = await request(app)
      .post('/api/v1/rt/tables/missing/rematch')
      .set('X-SSE-Session', 's1')
      .send({})
    expect(res.status).toBe(404)
  })

  it('409s when the previous game is not yet completed', async () => {
    const app = makeApp()
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.rematchGame.mockResolvedValueOnce({
      ok: false, code: 'NOT_COMPLETED', message: 'Game not finished',
    })
    const res = await request(app)
      .post('/api/v1/rt/tables/abc/rematch')
      .set('X-SSE-Session', 's1')
      .send({})
    expect(res.status).toBe(409)
  })
})
