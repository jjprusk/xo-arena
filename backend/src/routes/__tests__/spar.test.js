// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mocks must precede dynamic imports.
vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.auth = { userId: 'ba-caller' }; next() },
  requireAdmin: (_req, _res, next) => next(),
  optionalAuth: (_req, _res, next) => next(),
}))
vi.mock('../../realtime/botGameRunner.js', () => ({
  botGameRunner: {
    startGame:             vi.fn(),
    listGames:             vi.fn(() => []),
    getGame:               vi.fn(() => null),
    findActiveSparForBot:  vi.fn(() => null),
    closeGameBySlug:       vi.fn(),
  },
}))
vi.mock('../../lib/db.js', () => ({
  default: {
    user:  { findUnique: vi.fn() },
    table: { delete: vi.fn().mockResolvedValue({}) },
  },
}))
// createTableTracked is the wrapper around db.table.create — mocked here so
// the spar route's new "create a Table row up-front" step doesn't need a
// real DB. Returns a deterministic row that mirrors the schema shape the
// route's response leans on.
vi.mock('../../lib/createTableTracked.js', () => ({
  createTableTracked: vi.fn(async ({ data }) => ({ id: 'tbl_spar', ...data })),
}))
vi.mock('../../utils/roles.js', () => ({
  hasRole: vi.fn(() => false),
}))

const { botGameRunner } = await import('../../realtime/botGameRunner.js')
const db                = (await import('../../lib/db.js')).default
const botGamesRouter    = (await import('../botGames.js')).default

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/', botGamesRouter)
  return app
}

const CALLER = { id: 'user-caller' }
const MY_BOT = {
  id:               'bot-mine',
  displayName:      'My Bot',
  botModelId:       'user:user-caller:minimax:novice',
  isBot:            true,
  botActive:        true,
  botOwnerId:       'user-caller',
  botInTournament:  false,
}
const RUSTY    = { id: 'sysbot-rusty',    displayName: 'Rusty',    botModelId: 'builtin:minimax:novice',       isBot: true, botActive: true }
const COPPER   = { id: 'sysbot-copper',   displayName: 'Copper',   botModelId: 'builtin:minimax:intermediate', isBot: true, botActive: true }
const STERLING = { id: 'sysbot-sterling', displayName: 'Sterling', botModelId: 'builtin:minimax:advanced',     isBot: true, botActive: true }

beforeEach(() => {
  vi.clearAllMocks()
  botGameRunner.startGame.mockResolvedValue({ slug: 'spar-slug', displayName: 'My Bot vs Rusty' })
  botGameRunner.findActiveSparForBot.mockReturnValue(null)
  db.user.findUnique.mockImplementation(({ where }) => {
    if (where.betterAuthId === 'ba-caller')   return Promise.resolve(CALLER)
    if (where.id           === 'bot-mine')    return Promise.resolve(MY_BOT)
    if (where.username     === 'bot-rusty')   return Promise.resolve(RUSTY)
    if (where.username     === 'bot-copper')  return Promise.resolve(COPPER)
    if (where.username     === 'bot-sterling') return Promise.resolve(STERLING)
    return Promise.resolve(null)
  })
})

describe('POST /practice — request validation', () => {
  it('400 when myBotId missing', async () => {
    const res = await request(buildApp()).post('/practice').send({ opponentTier: 'easy' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/myBotId/)
  })

  it('400 when opponentTier missing', async () => {
    const res = await request(buildApp()).post('/practice').send({ myBotId: 'bot-mine' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/opponentTier/)
  })

  it('400 when opponentTier is not in {easy, medium, hard}', async () => {
    const res = await request(buildApp()).post('/practice').send({ myBotId: 'bot-mine', opponentTier: 'godlike' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/easy.*medium.*hard/)
  })
})

describe('POST /practice — ownership + bot state', () => {
  it('404 when caller user row missing', async () => {
    db.user.findUnique.mockImplementationOnce(() => Promise.resolve(null))
    const res = await request(buildApp()).post('/practice').send({ myBotId: 'bot-mine', opponentTier: 'easy' })
    expect(res.status).toBe(404)
  })

  it('404 when myBotId does not resolve to a bot', async () => {
    db.user.findUnique.mockImplementation(({ where }) => {
      if (where.betterAuthId === 'ba-caller') return Promise.resolve(CALLER)
      if (where.id === 'bot-mine')            return Promise.resolve(null)
      return Promise.resolve(null)
    })
    const res = await request(buildApp()).post('/practice').send({ myBotId: 'bot-mine', opponentTier: 'easy' })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/myBot not found/)
  })

  it('403 when caller does not own myBot', async () => {
    db.user.findUnique.mockImplementation(({ where }) => {
      if (where.betterAuthId === 'ba-caller') return Promise.resolve(CALLER)
      if (where.id === 'bot-mine')            return Promise.resolve({ ...MY_BOT, botOwnerId: 'someone-else' })
      if (where.username === 'bot-rusty')     return Promise.resolve(RUSTY)
      return Promise.resolve(null)
    })
    const res = await request(buildApp()).post('/practice').send({ myBotId: 'bot-mine', opponentTier: 'easy' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/do not own/)
  })

  it('409 when myBot is inactive', async () => {
    db.user.findUnique.mockImplementation(({ where }) => {
      if (where.betterAuthId === 'ba-caller') return Promise.resolve(CALLER)
      if (where.id === 'bot-mine')            return Promise.resolve({ ...MY_BOT, botActive: false })
      if (where.username === 'bot-rusty')     return Promise.resolve(RUSTY)
      return Promise.resolve(null)
    })
    const res = await request(buildApp()).post('/practice').send({ myBotId: 'bot-mine', opponentTier: 'easy' })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/inactive/)
  })

  it('409 when myBot is in a tournament', async () => {
    db.user.findUnique.mockImplementation(({ where }) => {
      if (where.betterAuthId === 'ba-caller') return Promise.resolve(CALLER)
      if (where.id === 'bot-mine')            return Promise.resolve({ ...MY_BOT, botInTournament: true })
      if (where.username === 'bot-rusty')     return Promise.resolve(RUSTY)
      return Promise.resolve(null)
    })
    const res = await request(buildApp()).post('/practice').send({ myBotId: 'bot-mine', opponentTier: 'easy' })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/tournament/)
  })
})

describe('POST /practice — tier → opponent bot resolution', () => {
  it('easy → Rusty', async () => {
    const res = await request(buildApp()).post('/practice').send({ myBotId: 'bot-mine', opponentTier: 'easy' })
    expect(res.status).toBe(201)
    expect(botGameRunner.startGame).toHaveBeenCalledWith(expect.objectContaining({
      bot1: MY_BOT,
      bot2: RUSTY,
      isSpar: true,
      sparUserId: 'user-caller',
    }))
  })

  it('medium → Copper', async () => {
    const res = await request(buildApp()).post('/practice').send({ myBotId: 'bot-mine', opponentTier: 'medium' })
    expect(res.status).toBe(201)
    expect(botGameRunner.startGame).toHaveBeenCalledWith(expect.objectContaining({ bot2: COPPER }))
  })

  it('hard → Sterling', async () => {
    const res = await request(buildApp()).post('/practice').send({ myBotId: 'bot-mine', opponentTier: 'hard' })
    expect(res.status).toBe(201)
    expect(botGameRunner.startGame).toHaveBeenCalledWith(expect.objectContaining({ bot2: STERLING }))
  })

  it('500 when the tier opponent is missing from the seed', async () => {
    db.user.findUnique.mockImplementation(({ where }) => {
      if (where.betterAuthId === 'ba-caller') return Promise.resolve(CALLER)
      if (where.id === 'bot-mine')            return Promise.resolve(MY_BOT)
      // simulate seed missing → no bot-rusty row
      return Promise.resolve(null)
    })
    const res = await request(buildApp()).post('/practice').send({ myBotId: 'bot-mine', opponentTier: 'easy' })
    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/seed/)
  })
})

describe('POST /practice — one-active-spar-per-bot replacement', () => {
  it('does NOT call closeGameBySlug when no prior spar is in-flight', async () => {
    botGameRunner.findActiveSparForBot.mockReturnValue(null)
    const res = await request(buildApp()).post('/practice').send({ myBotId: 'bot-mine', opponentTier: 'easy' })
    expect(res.status).toBe(201)
    expect(botGameRunner.closeGameBySlug).not.toHaveBeenCalled()
  })

  it('calls closeGameBySlug for the prior spar before starting a new one', async () => {
    botGameRunner.findActiveSparForBot.mockReturnValue('old-spar-slug')
    const res = await request(buildApp()).post('/practice').send({ myBotId: 'bot-mine', opponentTier: 'medium' })
    expect(res.status).toBe(201)
    expect(botGameRunner.findActiveSparForBot).toHaveBeenCalledWith('bot-mine')
    expect(botGameRunner.closeGameBySlug).toHaveBeenCalledWith('old-spar-slug')
    // Replacement happens BEFORE startGame
    const closeCall = botGameRunner.closeGameBySlug.mock.invocationCallOrder[0]
    const startCall = botGameRunner.startGame.mock.invocationCallOrder[0]
    expect(closeCall).toBeLessThan(startCall)
  })
})

describe('POST /practice — happy path response shape', () => {
  it('returns 201 with slug, displayName, opponentTier echoed', async () => {
    const res = await request(buildApp()).post('/practice').send({ myBotId: 'bot-mine', opponentTier: 'medium' })
    expect(res.status).toBe(201)
    // tableId is the new field — the route now allocates a Table row up-front
    // so the spectator's /rt/tables/:slug/join doesn't 404.
    expect(res.body).toEqual({
      slug:         'spar-slug',
      displayName:  'My Bot vs Rusty',
      opponentTier: 'medium',
      tableId:      'tbl_spar',
    })
  })

  // ── Table-row backing (regression for "Table closed due to inactivity") ──
  // Before this fix, /practice called botGameRunner.startGame() but never
  // created a Table row. The spectator's /rt/tables/:slug/join then 404'd,
  // useGameSDK mapped that to setAbandoned({reason:'stale'}), and PlayPage
  // rendered "Table closed due to inactivity" — even though the bot game
  // was running fine. Locking it down so a refactor can't drop the row.
  it('creates a Table row up-front so the spectator join lands somewhere', async () => {
    const { createTableTracked } = await import('../../lib/createTableTracked.js')
    await request(buildApp()).post('/practice').send({ myBotId: 'bot-mine', opponentTier: 'easy' })

    expect(createTableTracked).toHaveBeenCalledTimes(1)
    const call = createTableTracked.mock.calls[0][0]
    expect(call.data).toMatchObject({
      gameId:       'xo',
      isPrivate:    true,
      isTournament: false,
      status:       'ACTIVE',
      createdById:  'ba-caller',
      seats: [
        expect.objectContaining({ userId: 'bot-mine',     status: 'occupied', displayName: 'My Bot' }),
        expect.objectContaining({ userId: 'sysbot-rusty', status: 'occupied', displayName: 'Rusty'  }),
      ],
    })
    // Slug must be the same one passed to botGameRunner.startGame so the
    // bot moves emit on the table:<id>:state channel the client subscribes
    // to (botGameRunner resolves Table.id from this slug at startGame time).
    expect(typeof call.data.slug).toBe('string')
    expect(botGameRunner.startGame).toHaveBeenCalledWith(expect.objectContaining({ slug: call.data.slug }))
  })

  it('rolls back the Table row when botGameRunner.startGame throws', async () => {
    botGameRunner.startGame.mockRejectedValueOnce(new Error('no slot'))
    const res = await request(buildApp()).post('/practice').send({ myBotId: 'bot-mine', opponentTier: 'easy' })
    expect(res.status).toBe(503)
    expect(db.table.delete).toHaveBeenCalledWith({ where: { id: 'tbl_spar' } })
  })

  it('passes moveDelayMs through when provided', async () => {
    await request(buildApp()).post('/practice').send({ myBotId: 'bot-mine', opponentTier: 'easy', moveDelayMs: 800 })
    expect(botGameRunner.startGame).toHaveBeenCalledWith(expect.objectContaining({ moveDelayMs: 800 }))
  })
})
