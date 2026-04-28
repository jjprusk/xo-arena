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
})

describe('POST /api/v1/rt/tables/:slug/join', () => {
  it('joins as a player by default and tracks the table on the session', async () => {
    const app = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', betterAuthId: 'ba_user_1', displayName: 'B',
    })
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.joinTable.mockResolvedValueOnce({
      ok: true, action: 'guest_seated',
      table: { id: 'tbl_1' }, mark: 'O',
      room: { id: 'tbl_1', seats: [], previewState: {} },
      bothSeated: true,
    })

    const res = await request(app)
      .post('/api/v1/rt/tables/abc/join')
      .set('X-SSE-Session', 's1')
      .send({})

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ action: 'guest_seated', mark: 'O', tableId: 'tbl_1' })
    expect(flow.joinTable).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'abc', role: 'player', seatId: 'ba_user_1',
    }))
    expect(sseSessions.tablesFor('s1')).toContain('tbl_1')
  })

  it('passes role=spectator through to the service', async () => {
    const app = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', betterAuthId: 'ba_user_1', displayName: 'B',
    })
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.joinTable.mockResolvedValueOnce({
      ok: true, action: 'spectated_pvp', table: { id: 'tbl_1' },
    })

    await request(app)
      .post('/api/v1/rt/tables/abc/join')
      .set('X-SSE-Session', 's1')
      .send({ role: 'spectator' })

    expect(flow.joinTable).toHaveBeenCalledWith(expect.objectContaining({ role: 'spectator' }))
  })

  it('404s when the table does not exist', async () => {
    const app = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', betterAuthId: 'ba_user_1', displayName: 'B',
    })
    flow.joinTable.mockResolvedValueOnce({ ok: false, code: 'TABLE_NOT_FOUND', message: 'gone' })

    const res = await request(app)
      .post('/api/v1/rt/tables/missing/join')
      .set('X-SSE-Session', 's1')
      .send({})
    expect(res.status).toBe(404)
  })

  it('409s when the room is full', async () => {
    const app = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', betterAuthId: 'ba_user_1', displayName: 'B',
    })
    flow.joinTable.mockResolvedValueOnce({ ok: false, code: 'ROOM_FULL', message: 'full' })

    const res = await request(app)
      .post('/api/v1/rt/tables/abc/join')
      .set('X-SSE-Session', 's1')
      .send({})
    expect(res.status).toBe(409)
  })

  it('403s when spectating a private table', async () => {
    const app = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', betterAuthId: 'ba_user_1', displayName: 'B',
    })
    flow.joinTable.mockResolvedValueOnce({ ok: false, code: 'PRIVATE_TABLE', message: 'private' })

    const res = await request(app)
      .post('/api/v1/rt/tables/abc/join')
      .set('X-SSE-Session', 's1')
      .send({ role: 'spectator' })
    expect(res.status).toBe(403)
  })

  it('uses guest:<sessionId> as seatId for guest joiners', async () => {
    const app = makeApp()
    sseSessions.register('s2', { userId: null })
    db.user.findUnique.mockResolvedValueOnce(null)
    flow.joinTable.mockResolvedValueOnce({
      ok: true, action: 'guest_seated', table: { id: 'tbl_g' }, mark: 'O',
    })

    await request(app)
      .post('/api/v1/rt/tables/g1/join')
      .set('X-SSE-Session', 's2')
      .send({})

    expect(flow.joinTable).toHaveBeenCalledWith(expect.objectContaining({
      seatId: 'guest:s2',
    }))
  })
})
