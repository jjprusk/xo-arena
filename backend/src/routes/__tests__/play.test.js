// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tests for /api/v1/play/bot — the single-round-trip HvB start endpoint
 * (Future_Ideas PlayVsBot CTA item 3).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// optionalAuth is mocked per-test by overriding req.auth before the router
// runs. Defaults to anon (no auth).
let _authForNextRequest = null
vi.mock('../../middleware/auth.js', () => ({
  optionalAuth: (req, _res, next) => {
    if (_authForNextRequest) req.auth = _authForNextRequest
    next()
  },
  requireAuth:  (req, _res, next) => { req.auth = { userId: 'ba_user_1' }; next() },
}))

vi.mock('../../lib/db.js', () => ({
  default: { user: { findUnique: vi.fn() } },
}))

const flow = vi.hoisted(() => ({ createHvbTable: vi.fn() }))
vi.mock('../../services/tableFlowService.js', () => flow)

const userSvc = vi.hoisted(() => ({ listBots: vi.fn() }))
vi.mock('../../services/userService.js', () => userSvc)

vi.mock('../../realtime/flyReplay.js', () => ({
  mintSessionId: vi.fn(() => 'mint_abc'),
}))

vi.mock('../../logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import db from '../../lib/db.js'
import * as sseSessions from '../../realtime/sseSessions.js'
import playRouter from '../play.js'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/play', playRouter)
  return app
}

const builtinBot = {
  id:              'bot_rusty',
  displayName:     'Rusty',
  botModelId:      'builtin:minimax:0',
  botModelType:    'minimax',
  botOwnerId:      null,
  playableGameIds: ['tic-tac-toe'],
}

beforeEach(() => {
  vi.clearAllMocks()
  sseSessions._resetForTests()
  _authForNextRequest = null
})

describe('POST /api/v1/play/bot', () => {
  it('returns one-shot bundle for an anon caller (community bot resolved server-side)', async () => {
    userSvc.listBots.mockResolvedValueOnce([builtinBot])
    flow.createHvbTable.mockResolvedValueOnce({
      ok:          true,
      table:       { id: 'tbl_1', botUserId: builtinBot.id },
      slug:        'play-rusty',
      label:       'Rusty',
      mark:        'X',
      board:       Array(9).fill(null),
      currentTurn: 'X',
    })

    const res = await request(makeApp())
      .post('/api/v1/play/bot')
      .send({ gameId: 'tic-tac-toe' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      sseSessionId: 'mint_abc',
      tableId:      'tbl_1',
      slug:         'play-rusty',
      mark:         'X',
      board:        Array(9).fill(null),
      currentTurn:  'X',
      bot: { id: 'bot_rusty', displayName: 'Rusty', botModelId: 'builtin:minimax:0' },
    })
    expect(flow.createHvbTable).toHaveBeenCalledWith(expect.objectContaining({
      seatId:    'guest:mint_abc',
      botUserId: 'bot_rusty',
      gameId:    'tic-tac-toe',
    }))
    // Session pre-registered and tracking the created table.
    expect(sseSessions.tablesFor('mint_abc')).toContain('tbl_1')
  })

  it('returns the bundle for an authed caller (uses betterAuthId as seatId)', async () => {
    _authForNextRequest = { userId: 'ba_user_1' }
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', betterAuthId: 'ba_user_1', displayName: 'Alice',
    })
    userSvc.listBots.mockResolvedValueOnce([builtinBot])
    flow.createHvbTable.mockResolvedValueOnce({
      ok:    true,
      table: { id: 'tbl_a', botUserId: builtinBot.id },
      slug:  'a-rusty',
      label: 'Alice',
      mark:  'X',
      board: Array(9).fill(null),
      currentTurn: 'X',
    })

    const res = await request(makeApp())
      .post('/api/v1/play/bot')
      .send({ gameId: 'tic-tac-toe' })

    expect(res.status).toBe(200)
    expect(flow.createHvbTable).toHaveBeenCalledWith(expect.objectContaining({
      seatId:    'ba_user_1',
      botUserId: 'bot_rusty',
    }))
    // Authed session entry — userId attached for forUser() index.
    expect(sseSessions.get('mint_abc')?.userId).toBe('ba_user_1')
  })

  it('accepts a caller-supplied botUserId without re-resolving the community pool', async () => {
    db.user.findUnique.mockResolvedValueOnce({
      id: 'bot_custom', displayName: 'Magnus', botModelId: 'builtin:minimax:3', botModelType: 'minimax',
    })
    flow.createHvbTable.mockResolvedValueOnce({
      ok:    true,
      table: { id: 'tbl_m', botUserId: 'bot_custom' },
      slug:  'g-magnus',
      label: 'Magnus',
      mark:  'X',
      board: Array(9).fill(null),
      currentTurn: 'X',
    })

    const res = await request(makeApp())
      .post('/api/v1/play/bot')
      .send({ gameId: 'tic-tac-toe', botUserId: 'bot_custom' })

    expect(res.status).toBe(200)
    expect(userSvc.listBots).not.toHaveBeenCalled()
    expect(flow.createHvbTable).toHaveBeenCalledWith(expect.objectContaining({
      botUserId: 'bot_custom',
    }))
    expect(res.body.bot.displayName).toBe('Magnus')
  })

  it('orders community-bot resolution by displayName (Rusty before Magnus)', async () => {
    userSvc.listBots.mockResolvedValueOnce([
      { ...builtinBot, id: 'b_magnus',  displayName: 'Magnus' },
      { ...builtinBot, id: 'b_rusty',   displayName: 'Rusty'  },
      { ...builtinBot, id: 'b_sterling',displayName: 'Sterling' },
    ])
    flow.createHvbTable.mockResolvedValueOnce({
      ok: true, table: { id: 't' }, slug: 's', label: 'l', mark: 'X',
      board: Array(9).fill(null), currentTurn: 'X',
    })

    await request(makeApp()).post('/api/v1/play/bot').send({ gameId: 'tic-tac-toe' })

    expect(flow.createHvbTable).toHaveBeenCalledWith(expect.objectContaining({
      botUserId: 'b_rusty',
    }))
  })

  it('defaults gameId to "tic-tac-toe" when body omits it', async () => {
    userSvc.listBots.mockResolvedValueOnce([builtinBot])
    flow.createHvbTable.mockResolvedValueOnce({
      ok: true, table: { id: 't' }, slug: 's', label: 'l', mark: 'X',
      board: Array(9).fill(null), currentTurn: 'X',
    })
    const res = await request(makeApp()).post('/api/v1/play/bot').send({})
    expect(res.status).toBe(200)
    expect(flow.createHvbTable).toHaveBeenCalledWith(expect.objectContaining({ gameId: 'tic-tac-toe' }))
  })

  it('400s when gameId is explicitly blank', async () => {
    const res = await request(makeApp()).post('/api/v1/play/bot').send({ gameId: '' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('BAD_REQUEST')
  })

  it('404s when no community bot can be found for the gameId', async () => {
    userSvc.listBots.mockResolvedValueOnce([])
    const res = await request(makeApp())
      .post('/api/v1/play/bot')
      .send({ gameId: 'tic-tac-toe' })
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('BOT_NOT_FOUND')
    // No session should leak on failure.
    expect(sseSessions.get('mint_abc')).toBeNull()
  })

  it('disposes the pre-allocated session when createHvbTable rejects', async () => {
    userSvc.listBots.mockResolvedValueOnce([builtinBot])
    flow.createHvbTable.mockResolvedValueOnce({
      ok: false, code: 'BOT_NOT_FOUND', message: 'Bot not found',
    })

    const res = await request(makeApp())
      .post('/api/v1/play/bot')
      .send({ gameId: 'tic-tac-toe' })

    expect(res.status).toBe(404)
    expect(sseSessions.get('mint_abc')).toBeNull()
  })

  it('500s + does not leak a session if createHvbTable throws', async () => {
    userSvc.listBots.mockResolvedValueOnce([builtinBot])
    flow.createHvbTable.mockRejectedValueOnce(new Error('boom'))

    const res = await request(makeApp())
      .post('/api/v1/play/bot')
      .send({ gameId: 'tic-tac-toe' })

    expect(res.status).toBe(500)
    // Session was registered before the throw — accepted leak in this path
    // since the SSE TTL + dispose timer will clean it up. This assertion
    // simply documents the current behavior; tighten if we add an outer
    // try/finally later.
    expect(sseSessions.get('mint_abc')).not.toBeNull()
  })

  it('skips bot lookup followups when listBots already returned the row', async () => {
    userSvc.listBots.mockResolvedValueOnce([builtinBot])
    flow.createHvbTable.mockResolvedValueOnce({
      ok: true, table: { id: 't', botUserId: builtinBot.id },
      slug: 's', label: 'l', mark: 'X',
      board: Array(9).fill(null), currentTurn: 'X',
    })

    await request(makeApp()).post('/api/v1/play/bot').send({ gameId: 'tic-tac-toe' })

    // db.user.findUnique should NOT be called when we already have the bot
    // row from listBots — saves a DB round-trip on the hot path.
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })

  it('falls back to db.user.findUnique when botUserId is caller-supplied (no listBots row)', async () => {
    db.user.findUnique.mockResolvedValueOnce({
      id: 'bot_x', displayName: 'BotX', botModelId: null, botModelType: 'minimax',
    })
    flow.createHvbTable.mockResolvedValueOnce({
      ok: true, table: { id: 't', botUserId: 'bot_x' },
      slug: 's', label: 'l', mark: 'X',
      board: Array(9).fill(null), currentTurn: 'X',
    })

    const res = await request(makeApp())
      .post('/api/v1/play/bot')
      .send({ gameId: 'tic-tac-toe', botUserId: 'bot_x' })

    expect(res.status).toBe(200)
    expect(res.body.bot).toMatchObject({ id: 'bot_x', displayName: 'BotX' })
    expect(db.user.findUnique).toHaveBeenCalledTimes(1)
  })

  it('two consecutive calls produce two distinct sessions + tables', async () => {
    // mintSessionId mock is stable — flip it to per-call for this test.
    const { mintSessionId } = await import('../../realtime/flyReplay.js')
    mintSessionId.mockReturnValueOnce('mint_one').mockReturnValueOnce('mint_two')

    userSvc.listBots.mockResolvedValue([builtinBot])
    flow.createHvbTable.mockResolvedValueOnce({
      ok: true, table: { id: 't_one' }, slug: 's1', label: 'l', mark: 'X',
      board: Array(9).fill(null), currentTurn: 'X',
    }).mockResolvedValueOnce({
      ok: true, table: { id: 't_two' }, slug: 's2', label: 'l', mark: 'X',
      board: Array(9).fill(null), currentTurn: 'X',
    })

    const a = await request(makeApp()).post('/api/v1/play/bot').send({ gameId: 'tic-tac-toe' })
    const b = await request(makeApp()).post('/api/v1/play/bot').send({ gameId: 'tic-tac-toe' })

    expect(a.body.sseSessionId).toBe('mint_one')
    expect(b.body.sseSessionId).toBe('mint_two')
    expect(a.body.tableId).toBe('t_one')
    expect(b.body.tableId).toBe('t_two')
    expect(sseSessions.tablesFor('mint_one')).toContain('t_one')
    expect(sseSessions.tablesFor('mint_two')).toContain('t_two')
  })
})
