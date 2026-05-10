// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Phase C.2 — GET /api/v1/bots/quick-match
 *
 * Picks a single active bot near the caller's ELO so the home-page
 * Quick Match CTA can route directly to a one-click HvB game.
 *
 * Covers:
 *  - Authenticated caller: ELO target read from caller's GameElo
 *  - Guest caller: defaults to ELO 1500 (no auth required)
 *  - Caller's own bots are excluded (no self-match)
 *  - Inactive bots are excluded
 *  - Wider window fallback (±300) when initial window yields nothing
 *  - 404 NO_CANDIDATES when even widened window is empty
 *  - gameId / eloWindow query params honored
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const { authState } = vi.hoisted(() => ({
  authState: { userId: null },
}))

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    if (!authState.userId) return _res.status(401).json({ error: 'unauth' })
    req.auth = { userId: authState.userId }
    next()
  },
  optionalAuth: (req, _res, next) => {
    if (authState.userId) req.auth = { userId: authState.userId }
    next()
  },
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    user:    { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    gameElo: { findUnique: vi.fn() },
  },
}))

vi.mock('../../services/userService.js', () => ({
  createBot: vi.fn(),
  listBots:  vi.fn().mockResolvedValue([]),
  checkBotName: vi.fn(),
}))
vi.mock('../../services/skillService.js', () => ({ getSystemConfig: vi.fn() }))
vi.mock('../../services/creditService.js', () => ({ getTierLimit: vi.fn().mockResolvedValue(5) }))
vi.mock('../../services/journeyService.js', () => ({ completeStep: vi.fn() }))
vi.mock('../../services/userDeletionService.js', () => ({
  deleteBot: vi.fn(),
  BuiltinBotProtectedError: class extends Error {},
}))
vi.mock('../../services/mlService.js', () => ({}))
vi.mock('../../utils/cache.js', () => ({ default: { get: vi.fn(), set: vi.fn() } }))
vi.mock('../../utils/roles.js', () => ({ hasRole: vi.fn().mockReturnValue(false) }))

import db from '../../lib/db.js'
import botsRouter from '../bots.js'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/bots', botsRouter)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.userId = null
})

const BOTS_NEAR = [
  { id: 'b_a', displayName: 'Sterling',  gameElo: [{ rating: 1480 }] },
  { id: 'b_b', displayName: 'Copper',    gameElo: [{ rating: 1520 }] },
]

describe('GET /api/v1/bots/quick-match', () => {
  it('guest path: defaults to ELO 1500, returns one of the candidates', async () => {
    db.user.findMany.mockResolvedValueOnce(BOTS_NEAR)

    const res = await request(makeApp()).get('/api/v1/bots/quick-match')
    expect(res.status).toBe(200)
    expect(['b_a', 'b_b']).toContain(res.body.botUserId)
    expect(res.body.displayName).toBeTruthy()
    // findUnique on User shouldn't have been called (no authed userId)
    expect(db.user.findUnique).not.toHaveBeenCalled()

    // The query window centered on default 1500 ± 100
    const where = db.user.findMany.mock.calls[0][0].where
    expect(where.gameElo.some.rating).toEqual({ gte: 1400, lte: 1600 })
    expect(where.isBot).toBe(true)
    expect(where.botActive).toBe(true)
    expect(where.botOwnerId).toBeUndefined()  // no caller exclusion for guests
  })

  it('authed path: reads caller ELO and excludes caller-owned bots', async () => {
    authState.userId = 'ba_alice'
    db.user.findUnique.mockResolvedValueOnce({ id: 'u_alice' })
    db.gameElo.findUnique.mockResolvedValueOnce({ rating: 1750 })
    db.user.findMany.mockResolvedValueOnce([
      { id: 'b_a', displayName: 'Sterling', gameElo: [{ rating: 1700 }] },
    ])

    const res = await request(makeApp()).get('/api/v1/bots/quick-match')
    expect(res.status).toBe(200)
    expect(res.body.botUserId).toBe('b_a')

    const where = db.user.findMany.mock.calls[0][0].where
    expect(where.botOwnerId).toEqual({ not: 'u_alice' })
    expect(where.gameElo.some.rating).toEqual({ gte: 1650, lte: 1850 })
  })

  it('authed caller with no GameElo row falls back to default 1500', async () => {
    authState.userId = 'ba_alice'
    db.user.findUnique.mockResolvedValueOnce({ id: 'u_alice' })
    db.gameElo.findUnique.mockResolvedValueOnce(null)
    db.user.findMany.mockResolvedValueOnce(BOTS_NEAR)

    const res = await request(makeApp()).get('/api/v1/bots/quick-match')
    expect(res.status).toBe(200)
    const where = db.user.findMany.mock.calls[0][0].where
    expect(where.gameElo.some.rating).toEqual({ gte: 1400, lte: 1600 })
  })

  it('honors eloWindow query param', async () => {
    db.user.findMany.mockResolvedValueOnce(BOTS_NEAR)
    await request(makeApp()).get('/api/v1/bots/quick-match?eloWindow=50')
    const where = db.user.findMany.mock.calls[0][0].where
    expect(where.gameElo.some.rating).toEqual({ gte: 1450, lte: 1550 })
  })

  it('coerces invalid eloWindow back to the default 100', async () => {
    db.user.findMany.mockResolvedValueOnce(BOTS_NEAR)
    await request(makeApp()).get('/api/v1/bots/quick-match?eloWindow=notanumber')
    const where = db.user.findMany.mock.calls[0][0].where
    expect(where.gameElo.some.rating).toEqual({ gte: 1400, lte: 1600 })
  })

  it('honors gameId query param', async () => {
    db.user.findMany.mockResolvedValueOnce(BOTS_NEAR)
    await request(makeApp()).get('/api/v1/bots/quick-match?gameId=connect4')
    const where = db.user.findMany.mock.calls[0][0].where
    expect(where.gameElo.some.gameId).toBe('connect4')
  })

  it('widens to ±300 when the requested window is empty', async () => {
    db.user.findMany
      .mockResolvedValueOnce([])           // ±100 search → nothing
      .mockResolvedValueOnce(BOTS_NEAR)    // ±300 fallback → bots

    const res = await request(makeApp()).get('/api/v1/bots/quick-match?eloWindow=100')
    expect(res.status).toBe(200)
    expect(['b_a', 'b_b']).toContain(res.body.botUserId)

    expect(db.user.findMany).toHaveBeenCalledTimes(2)
    const widenedWhere = db.user.findMany.mock.calls[1][0].where
    expect(widenedWhere.gameElo.some.rating).toEqual({ gte: 1200, lte: 1800 })
  })

  it('returns 404 NO_CANDIDATES when even the widened window is empty', async () => {
    db.user.findMany.mockResolvedValue([])

    const res = await request(makeApp()).get('/api/v1/bots/quick-match')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NO_CANDIDATES')
  })

  it('does NOT widen when the requested window is already ≥ 300', async () => {
    db.user.findMany.mockResolvedValueOnce([])  // single empty result
    const res = await request(makeApp()).get('/api/v1/bots/quick-match?eloWindow=400')
    expect(res.status).toBe(404)
    // Only one query — no fallback widen
    expect(db.user.findMany).toHaveBeenCalledTimes(1)
  })
})
