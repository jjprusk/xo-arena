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

describe('POST /api/v1/rt/tables/:slug/move', () => {
  it('400s when cellIndex is missing or out of range', async () => {
    const app = makeApp()
    const r1 = await request(app).post('/api/v1/rt/tables/abc/move').set('X-SSE-Session', 's1').send({})
    expect(r1.status).toBe(400)
    const r2 = await request(app).post('/api/v1/rt/tables/abc/move').set('X-SSE-Session', 's1').send({ cellIndex: 9 })
    expect(r2.status).toBe(400)
    const r3 = await request(app).post('/api/v1/rt/tables/abc/move').set('X-SSE-Session', 's1').send({ cellIndex: -1 })
    expect(r3.status).toBe(400)
    expect(flow.applyMove).not.toHaveBeenCalled()
  })

  it('404s when the table does not exist', async () => {
    const app = makeApp()
    db.table.findFirst.mockResolvedValueOnce(null)
    const res = await request(app)
      .post('/api/v1/rt/tables/missing/move')
      .set('X-SSE-Session', 's1')
      .send({ cellIndex: 4 })
    expect(res.status).toBe(404)
    expect(flow.applyMove).not.toHaveBeenCalled()
  })

  it('forwards a legal move to the service and reports completed=false', async () => {
    const app = makeApp()
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.applyMove.mockResolvedValueOnce({ ok: true, completed: false, mark: 'X' })

    const res = await request(app)
      .post('/api/v1/rt/tables/abc/move')
      .set('X-SSE-Session', 's1')
      .send({ cellIndex: 4 })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, completed: false, mark: 'X' })
    expect(flow.applyMove).toHaveBeenCalledWith(expect.objectContaining({
      tableId:   'tbl_1',
      userId:    'ba_user_1',
      cellIndex: 4,
    }))
  })

  it('reports completed=true on a winning move', async () => {
    const app = makeApp()
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.applyMove.mockResolvedValueOnce({ ok: true, completed: true, mark: 'X' })

    const res = await request(app)
      .post('/api/v1/rt/tables/abc/move')
      .set('X-SSE-Session', 's1')
      .send({ cellIndex: 8 })
    expect(res.body.completed).toBe(true)
  })

  it('410s when the table is no longer ACTIVE', async () => {
    const app = makeApp()
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.applyMove.mockResolvedValueOnce({ ok: false, code: 'NOT_ACTIVE', message: 'over' })
    const res = await request(app)
      .post('/api/v1/rt/tables/abc/move')
      .set('X-SSE-Session', 's1')
      .send({ cellIndex: 0 })
    expect(res.status).toBe(410)
  })

  it('409s when it is not the caller\'s turn', async () => {
    const app = makeApp()
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.applyMove.mockResolvedValueOnce({ ok: false, code: 'NOT_YOUR_TURN', message: 'wait' })
    const res = await request(app)
      .post('/api/v1/rt/tables/abc/move')
      .set('X-SSE-Session', 's1')
      .send({ cellIndex: 0 })
    expect(res.status).toBe(409)
  })

  it('409s when the cell is already occupied', async () => {
    const app = makeApp()
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.applyMove.mockResolvedValueOnce({ ok: false, code: 'CELL_OCCUPIED', message: 'taken' })
    const res = await request(app)
      .post('/api/v1/rt/tables/abc/move')
      .set('X-SSE-Session', 's1')
      .send({ cellIndex: 0 })
    expect(res.status).toBe(409)
  })

  it('403s when the caller is not seated', async () => {
    const app = makeApp()
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.applyMove.mockResolvedValueOnce({ ok: false, code: 'NOT_A_PLAYER', message: 'spec' })
    const res = await request(app)
      .post('/api/v1/rt/tables/abc/move')
      .set('X-SSE-Session', 's1')
      .send({ cellIndex: 0 })
    expect(res.status).toBe(403)
  })
})
