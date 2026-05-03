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

describe('POST /api/v1/rt/tables/:slug/forfeit', () => {
  it('forwards forfeit to the service and untracks the table on success', async () => {
    const app = makeApp()
    sseSessions.joinTable('s1', 'tbl_1')
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.forfeitGame.mockResolvedValueOnce({ ok: true, mark: 'X', oppMark: 'O' })

    const res = await request(app)
      .post('/api/v1/rt/tables/abc/forfeit')
      .set('X-SSE-Session', 's1')
      .send({})

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, mark: 'X', oppMark: 'O' })
    expect(flow.forfeitGame).toHaveBeenCalledWith(expect.objectContaining({
      tableId: 'tbl_1', userId: 'ba_user_1',
    }))
    expect(sseSessions.tablesFor('s1')).not.toContain('tbl_1')
  })

  it('404s when the table does not exist', async () => {
    const app = makeApp()
    db.table.findFirst.mockResolvedValueOnce(null)
    const res = await request(app)
      .post('/api/v1/rt/tables/missing/forfeit')
      .set('X-SSE-Session', 's1')
      .send({})
    expect(res.status).toBe(404)
  })

  it('403s when the caller is not seated', async () => {
    const app = makeApp()
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.forfeitGame.mockResolvedValueOnce({ ok: false, code: 'NOT_A_PLAYER' })
    const res = await request(app)
      .post('/api/v1/rt/tables/abc/forfeit')
      .set('X-SSE-Session', 's1')
      .send({})
    expect(res.status).toBe(403)
  })
})

describe('POST /api/v1/rt/tables/:slug/leave', () => {
  it('forwards leave to the service and untracks the table on success', async () => {
    const app = makeApp()
    sseSessions.joinTable('s1', 'tbl_1')
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.leaveGame.mockResolvedValueOnce({ ok: true })

    const res = await request(app)
      .post('/api/v1/rt/tables/abc/leave')
      .set('X-SSE-Session', 's1')
      .send({})
    expect(res.status).toBe(200)
    expect(flow.leaveGame).toHaveBeenCalledWith(expect.objectContaining({
      tableId: 'tbl_1', userId: 'ba_user_1',
    }))
    expect(sseSessions.tablesFor('s1')).not.toContain('tbl_1')
  })
})

describe('POST /api/v1/rt/tables/:slug/cancel', () => {
  it('forwards cancel to the service and untracks the table on success', async () => {
    const app = makeApp()
    sseSessions.joinTable('s1', 'tbl_1')
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.cancelTable.mockResolvedValueOnce({ ok: true })

    const res = await request(app)
      .post('/api/v1/rt/tables/abc/cancel')
      .set('X-SSE-Session', 's1')
      .send({})
    expect(res.status).toBe(200)
    expect(flow.cancelTable).toHaveBeenCalledWith(expect.objectContaining({ tableId: 'tbl_1' }))
    expect(sseSessions.tablesFor('s1')).not.toContain('tbl_1')
  })
})

describe('POST /api/v1/rt/tables/:slug/reaction', () => {
  it('400s when emoji is missing', async () => {
    const app = makeApp()
    const res = await request(app)
      .post('/api/v1/rt/tables/abc/reaction')
      .set('X-SSE-Session', 's1')
      .send({})
    expect(res.status).toBe(400)
    expect(flow.sendReaction).not.toHaveBeenCalled()
  })

  it('400s when the service rejects the emoji', async () => {
    const app = makeApp()
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.sendReaction.mockResolvedValueOnce({ ok: false, code: 'INVALID_EMOJI' })
    const res = await request(app)
      .post('/api/v1/rt/tables/abc/reaction')
      .set('X-SSE-Session', 's1')
      .send({ emoji: '🎲' })
    expect(res.status).toBe(400)
  })

  it('forwards a valid reaction to the service', async () => {
    const app = makeApp()
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.sendReaction.mockResolvedValueOnce({ ok: true, payload: { emoji: '👍', fromMark: 'X' } })
    const res = await request(app)
      .post('/api/v1/rt/tables/abc/reaction')
      .set('X-SSE-Session', 's1')
      .send({ emoji: '👍' })
    expect(res.status).toBe(200)
    expect(flow.sendReaction).toHaveBeenCalledWith(expect.objectContaining({
      tableId: 'tbl_1', userId: 'ba_user_1', emoji: '👍',
    }))
  })
})
