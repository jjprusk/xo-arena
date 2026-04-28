// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Phase 3 — POST /api/v1/rt/tournaments/matches/:id/table.
 *
 * The route is the SSE+POST replacement for the legacy
 * `socket.emit('tournament:room:join', { matchId })` flow. It delegates to
 * `tournamentMatchService.joinMatchTable` (covered separately) — the tests
 * below pin down the route's contract: auth gate, error mapping, response
 * shape, and the SSE dual-emit on success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Phase 7a: /rt/* routes now use optionalAuth globally. Tests that exercise
// the authenticated path expect a user in req.auth, so the mock attaches one.
vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.auth = { userId: 'ba_user_1' }
    next()
  },
  optionalAuth: (req, _res, next) => {
    req.auth = { userId: 'ba_user_1' }
    next()
  },
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    user: { findUnique: vi.fn() },
  },
}))

vi.mock('../../services/skillService.js', () => ({
  getSystemConfig: vi.fn(async (_k, dflt) => dflt),
}))

vi.mock('../../services/tableService.js', () => ({
  handleIdlePong: vi.fn(),
}))

vi.mock('../../services/tournamentMatchService.js', async () => {
  const { TournamentMatchError } = await vi.importActual('../../services/tournamentMatchService.js')
  return {
    joinMatchTable: vi.fn(),
    TournamentMatchError,
  }
})

const { mockAppendToStream } = vi.hoisted(() => ({
  mockAppendToStream: vi.fn().mockResolvedValue('1-0'),
}))
vi.mock('../../lib/eventStream.js', () => ({ appendToStream: mockAppendToStream }))

vi.mock('../../logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import db from '../../lib/db.js'
import * as sseSessions from '../../realtime/sseSessions.js'
import { joinMatchTable, TournamentMatchError } from '../../services/tournamentMatchService.js'
import realtimeRouter from '../realtime.js'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/rt', realtimeRouter)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  sseSessions._resetForTests()
})

describe('POST /api/v1/rt/tournaments/matches/:id/table', () => {
  it('409s when X-SSE-Session header is missing', async () => {
    const app = makeApp()
    const res = await request(app)
      .post('/api/v1/rt/tournaments/matches/m1/table')
      .send({})
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('SSE_SESSION_MISSING')
  })

  it('409s when X-SSE-Session is unknown to the registry', async () => {
    const app = makeApp()
    const res = await request(app)
      .post('/api/v1/rt/tournaments/matches/m1/table')
      .set('X-SSE-Session', 'ghost')
      .send({})
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('SSE_SESSION_EXPIRED')
  })

  it('returns 200 with slug+mark+action=created for the first participant', async () => {
    const app = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', betterAuthId: 'ba_user_1', displayName: 'Alice',
    })
    joinMatchTable.mockResolvedValueOnce({
      action: 'created',
      slug: 'abc123',
      mark: 'X',
      tournamentId: 't1',
      matchId: 'm1',
      bestOfN: 3,
      tableId: 'tbl_1',
    })

    const res = await request(app)
      .post('/api/v1/rt/tournaments/matches/m1/table')
      .set('X-SSE-Session', 's1')
      .send({})

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      slug: 'abc123', mark: 'X', tournamentId: 't1', matchId: 'm1', bestOfN: 3,
      action: 'created',
    })
    expect(joinMatchTable).toHaveBeenCalledWith({
      user: expect.objectContaining({ betterAuthId: 'ba_user_1' }),
      matchId: 'm1',
    })
    // SSE dual-emit on the tournament prefix.
    const sseCall = mockAppendToStream.mock.calls.find(([ch]) => ch === 'tournament:t1:table:ready')
    expect(sseCall).toBeDefined()
    expect(sseCall[1]).toEqual({
      slug: 'abc123', mark: 'X', tournamentId: 't1', matchId: 'm1', bestOfN: 3,
    })
  })

  it('returns 200 with action=joined for the second participant', async () => {
    const app = makeApp()
    sseSessions.register('s2', { userId: 'user_2' })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_2', betterAuthId: 'ba_user_1', displayName: 'Bob',
    })
    joinMatchTable.mockResolvedValueOnce({
      action: 'joined',
      slug: 'abc123',
      mark: 'O',
      tournamentId: 't1',
      matchId: 'm1',
      bestOfN: 3,
      tableId: 'tbl_1',
    })

    const res = await request(app)
      .post('/api/v1/rt/tournaments/matches/m1/table')
      .set('X-SSE-Session', 's2')
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.action).toBe('joined')
    expect(res.body.mark).toBe('O')
  })

  it('404s when the pending match cannot be found', async () => {
    const app = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', betterAuthId: 'ba_user_1', displayName: null,
    })
    joinMatchTable.mockRejectedValueOnce(new TournamentMatchError('NOT_FOUND', 'Tournament match not found or already started'))

    const res = await request(app)
      .post('/api/v1/rt/tournaments/matches/missing/table')
      .set('X-SSE-Session', 's1')
      .send({})

    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
    // No SSE emit on failure.
    expect(mockAppendToStream).not.toHaveBeenCalled()
  })

  it('403s when the caller is not a participant', async () => {
    const app = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', betterAuthId: 'ba_user_1', displayName: null,
    })
    joinMatchTable.mockRejectedValueOnce(new TournamentMatchError('NOT_PARTICIPANT', 'You are not a participant in this match'))

    const res = await request(app)
      .post('/api/v1/rt/tournaments/matches/m1/table')
      .set('X-SSE-Session', 's1')
      .send({})

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('NOT_PARTICIPANT')
  })

  it('409s when the table is not ready (race during second-player join)', async () => {
    const app = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', betterAuthId: 'ba_user_1', displayName: null,
    })
    joinMatchTable.mockRejectedValueOnce(new TournamentMatchError('NOT_READY', 'Match not ready yet — please try again'))

    const res = await request(app)
      .post('/api/v1/rt/tournaments/matches/m1/table')
      .set('X-SSE-Session', 's1')
      .send({})

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('NOT_READY')
  })

  it('500s on unexpected errors', async () => {
    const app = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', betterAuthId: 'ba_user_1', displayName: null,
    })
    joinMatchTable.mockRejectedValueOnce(new Error('database exploded'))

    const res = await request(app)
      .post('/api/v1/rt/tournaments/matches/m1/table')
      .set('X-SSE-Session', 's1')
      .send({})

    expect(res.status).toBe(500)
  })
})
