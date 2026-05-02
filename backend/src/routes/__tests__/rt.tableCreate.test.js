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
  TournamentMatchError: class TournamentMatchError extends Error {
    constructor(code, msg) { super(msg ?? code); this.code = code }
  },
}))

const flow = vi.hoisted(() => ({
  createPvpTable: vi.fn(),
  createHvbTable: vi.fn(),
  joinTable:      vi.fn(),
  cancelTable:    vi.fn(),
  applyMove:      vi.fn(),
  forfeitGame:    vi.fn(),
  leaveGame:      vi.fn(),
  rematchGame:    vi.fn(),
  sendReaction:   vi.fn(),
}))
vi.mock('../../services/tableFlowService.js', () => flow)

const { mockAppendToStream } = vi.hoisted(() => ({
  mockAppendToStream: vi.fn().mockResolvedValue('1-0'),
}))
vi.mock('../../lib/eventStream.js', () => ({ appendToStream: mockAppendToStream }))

vi.mock('../../realtime/socketHandler.js', () => ({
  dispatchBotMove: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import db from '../../lib/db.js'
import * as sseSessions from '../../realtime/sseSessions.js'
import realtimeRouter from '../realtime.js'

function makeApp() {
  const mockIo = { to: vi.fn().mockReturnThis(), emit: vi.fn() }
  const app = express()
  app.use(express.json())
  app.set('io', mockIo)
  app.use('/api/v1/rt', realtimeRouter)
  return { app, mockIo }
}

beforeEach(() => {
  vi.clearAllMocks()
  sseSessions._resetForTests()
})

describe('POST /api/v1/rt/tables', () => {
  it('400s when kind is missing or invalid', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    const res = await request(app)
      .post('/api/v1/rt/tables')
      .set('X-SSE-Session', 's1')
      .send({ kind: 'bogus' })
    expect(res.status).toBe(400)
  })

  it('creates a PvP table and tracks the join on the session', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', betterAuthId: 'ba_user_1', displayName: 'Alice',
    })
    flow.createPvpTable.mockResolvedValueOnce({
      ok:    true,
      table: { id: 'tbl_1', slug: 'abc' },
      slug:  'abc',
      label: 'Alice',
      mark:  'X',
    })

    const res = await request(app)
      .post('/api/v1/rt/tables')
      .set('X-SSE-Session', 's1')
      .send({ kind: 'pvp' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ slug: 'abc', label: 'Alice', mark: 'X', action: 'created' })
    expect(flow.createPvpTable).toHaveBeenCalledWith(expect.objectContaining({
      seatId: 'ba_user_1',
      spectatorAllowed: true,
    }))
    expect(sseSessions.tablesFor('s1')).toContain('tbl_1')

    // Personal SSE one-shot keyed by domain user id.
    expect(mockAppendToStream).toHaveBeenCalledWith(
      'user:user_1:table:created',
      expect.objectContaining({ slug: 'abc', kind: 'pvp', action: 'created' }),
      { userId: 'user_1' },
    )
  })

  it('uses guest:<sessionId> as seatId for unauthed callers', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: null })
    db.user.findUnique.mockResolvedValueOnce(null)
    flow.createPvpTable.mockResolvedValueOnce({
      ok: true, table: { id: 'tbl_g' }, slug: 'g1', label: 'Guest', mark: 'X',
    })

    const res = await request(app)
      .post('/api/v1/rt/tables')
      .set('X-SSE-Session', 's1')
      .send({ kind: 'pvp' })

    expect(res.status).toBe(200)
    expect(flow.createPvpTable).toHaveBeenCalledWith(expect.objectContaining({
      seatId: 'guest:s1',
    }))
    // No personal user channel for guests.
    expect(mockAppendToStream).not.toHaveBeenCalledWith(
      expect.stringMatching(/^user:.*:table:created$/),
      expect.anything(),
      expect.anything(),
    )
  })

  it('400s on hvb create without botUserId', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', betterAuthId: 'ba_user_1', displayName: 'A',
    })

    const res = await request(app)
      .post('/api/v1/rt/tables')
      .set('X-SSE-Session', 's1')
      .send({ kind: 'hvb' })
    expect(res.status).toBe(400)
    expect(flow.createHvbTable).not.toHaveBeenCalled()
  })

  it('creates an HvB table and includes board+currentTurn in the response', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', betterAuthId: 'ba_user_1', displayName: 'A',
    })
    flow.createHvbTable.mockResolvedValueOnce({
      ok:          true,
      action:      'created',
      table:       { id: 'tbl_h' },
      slug:        'hvbslug',
      label:       'A vs Bot',
      mark:        'X',
      board:       Array(9).fill(null),
      currentTurn: 'X',
    })

    const res = await request(app)
      .post('/api/v1/rt/tables')
      .set('X-SSE-Session', 's1')
      .send({ kind: 'hvb', botUserId: 'bot_1', botSkillId: 'skill_1' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      slug: 'hvbslug', mark: 'X', action: 'created', currentTurn: 'X',
    })
    expect(res.body.board).toHaveLength(9)
    expect(flow.createHvbTable).toHaveBeenCalledWith(expect.objectContaining({
      seatId:     'ba_user_1',
      botUserId:  'bot_1',
      botSkillId: 'skill_1',
    }))
  })

  it('returns action=rejoined when the service rejoined an existing tournament table', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', betterAuthId: 'ba_user_1', displayName: 'A',
    })
    flow.createHvbTable.mockResolvedValueOnce({
      ok:          true,
      action:      'rejoined',
      table:       { id: 'tbl_h' },
      slug:        'rj',
      label:       'A vs Bot',
      mark:        'X',
      board:       Array(9).fill(null),
      currentTurn: 'O',
    })

    const res = await request(app)
      .post('/api/v1/rt/tables')
      .set('X-SSE-Session', 's1')
      .send({ kind: 'hvb', botUserId: 'bot_1', tournamentMatchId: 'tm_1' })

    expect(res.status).toBe(200)
    expect(res.body.action).toBe('rejoined')
  })

  it('404s when the bot does not exist', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', betterAuthId: 'ba_user_1', displayName: 'A',
    })
    flow.createHvbTable.mockResolvedValueOnce({
      ok: false, code: 'BOT_NOT_FOUND', message: 'Bot not found',
    })

    const res = await request(app)
      .post('/api/v1/rt/tables')
      .set('X-SSE-Session', 's1')
      .send({ kind: 'hvb', botUserId: 'missing' })
    expect(res.status).toBe(404)
  })

  it('dispatches the bot opening when the service flagged botOpeningPending', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', betterAuthId: 'ba_user_1', displayName: 'A',
    })
    flow.createHvbTable.mockResolvedValueOnce({
      ok: true, action: 'rematched',
      table: { id: 'tbl_h', isHvb: true },
      slug: 'rm', label: 'A vs Bot', mark: 'X',
      board: Array(9).fill(null), currentTurn: 'O',
      botOpeningPending: true,
    })

    const res = await request(app)
      .post('/api/v1/rt/tables')
      .set('X-SSE-Session', 's1')
      .send({ kind: 'hvb', botUserId: 'bot_1', tournamentMatchId: 'tm_1' })
    expect(res.status).toBe(200)
    expect(res.body.action).toBe('rematched')

    const sh = await import('../../realtime/socketHandler.js')
    expect(sh.dispatchBotMove).toHaveBeenCalled()
  })
})
