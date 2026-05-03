import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// ALL vi.mock() calls BEFORE any await import()
vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => { req.auth = { userId: 'test-user-id' }; next() },
  requireAdmin: (req, res, next) => next(),
  optionalAuth: (req, res, next) => next(),
}))
vi.mock('../../realtime/botGameRunner.js', () => ({
  botGameRunner: {
    startGame: vi.fn(),
    listGames: vi.fn(),
    getGame: vi.fn(),
  },
}))
vi.mock('../../lib/db.js', () => ({
  default: {
    user: { findUnique: vi.fn() },
  },
}))
vi.mock('../../utils/roles.js', () => ({
  hasRole: vi.fn(),
}))

const { botGameRunner } = await import('../../realtime/botGameRunner.js')
const db = (await import('../../lib/db.js')).default
const { hasRole } = await import('../../utils/roles.js')
const botGamesRouter = (await import('../botGames.js')).default

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/', botGamesRouter)
  return app
}

const ADMIN_USER = { id: 'caller-id', userRoles: [{ role: 'ADMIN' }] }
const BOT1 = { id: 'bot1', displayName: 'Alpha', botModelId: 'model-a', isBot: true, botActive: true }
const BOT2 = { id: 'bot2', displayName: 'Beta',  botModelId: 'model-b', isBot: true, botActive: true }

beforeEach(() => {
  vi.clearAllMocks()
  hasRole.mockImplementation((user, role) => {
    if (!user?.userRoles) return false
    const roles = user.userRoles.map(r => r.role)
    return roles.includes('ADMIN') || roles.includes(role)
  })
  // Default: caller is admin; bots exist and are active
  db.user.findUnique.mockImplementation(({ where }) => {
    if (where.betterAuthId === 'test-user-id') return Promise.resolve(ADMIN_USER)
    if (where.id === 'bot1') return Promise.resolve(BOT1)
    if (where.id === 'bot2') return Promise.resolve(BOT2)
    return Promise.resolve(null)
  })
  botGameRunner.startGame.mockResolvedValue({ slug: 'game-slug', displayName: 'Alpha vs Beta' })
  botGameRunner.listGames.mockReturnValue([])
  botGameRunner.getGame.mockReturnValue(null)
})

describe('POST /', () => {
  it('returns 401 when requireAuth rejects', async () => {
    // Override auth middleware to simulate unauthenticated request
    const { requireAuth } = await import('../../middleware/auth.js')
    vi.mocked(requireAuth)
    // Re-build a one-off app with a blocking auth middleware
    const app = express()
    app.use(express.json())
    app.use('/', (req, res, next) => res.status(401).json({ error: 'Unauthorized' }))
    app.use('/', botGamesRouter)

    const res = await request(app).post('/').send({ bot1Id: 'bot1', bot2Id: 'bot2' })
    expect(res.status).toBe(401)
  })

  it('returns 400 when bot1Id is missing', async () => {
    const res = await request(buildApp()).post('/').send({ bot2Id: 'bot2' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/bot1Id and bot2Id are required/)
  })

  it('returns 400 when bot2Id is missing', async () => {
    const res = await request(buildApp()).post('/').send({ bot1Id: 'bot1' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/bot1Id and bot2Id are required/)
  })

  it('returns 400 when bot1Id === bot2Id', async () => {
    const res = await request(buildApp()).post('/').send({ bot1Id: 'bot1', bot2Id: 'bot1' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Bots must be different/)
  })

  it('returns 403 when caller lacks ADMIN or BOT_ADMIN role', async () => {
    db.user.findUnique.mockImplementation(({ where }) => {
      if (where.betterAuthId === 'test-user-id') return Promise.resolve({ id: 'caller-id', userRoles: [] })
      if (where.id === 'bot1') return Promise.resolve(BOT1)
      if (where.id === 'bot2') return Promise.resolve(BOT2)
      return Promise.resolve(null)
    })
    hasRole.mockReturnValue(false)

    const res = await request(buildApp()).post('/').send({ bot1Id: 'bot1', bot2Id: 'bot2' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/ADMIN or BOT_ADMIN/)
  })

  it('returns 404 when bot1 is not found in the database', async () => {
    db.user.findUnique.mockImplementation(({ where }) => {
      if (where.betterAuthId === 'test-user-id') return Promise.resolve(ADMIN_USER)
      if (where.id === 'bot2') return Promise.resolve(BOT2)
      return Promise.resolve(null)
    })

    const res = await request(buildApp()).post('/').send({ bot1Id: 'missing-bot', bot2Id: 'bot2' })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/bot1 not found or not a bot/)
  })

  it('returns 404 when bot1.isBot is false', async () => {
    db.user.findUnique.mockImplementation(({ where }) => {
      if (where.betterAuthId === 'test-user-id') return Promise.resolve(ADMIN_USER)
      if (where.id === 'bot1') return Promise.resolve({ ...BOT1, isBot: false })
      if (where.id === 'bot2') return Promise.resolve(BOT2)
      return Promise.resolve(null)
    })

    const res = await request(buildApp()).post('/').send({ bot1Id: 'bot1', bot2Id: 'bot2' })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/bot1 not found or not a bot/)
  })

  it('returns 409 when bot1.botActive is false', async () => {
    db.user.findUnique.mockImplementation(({ where }) => {
      if (where.betterAuthId === 'test-user-id') return Promise.resolve(ADMIN_USER)
      if (where.id === 'bot1') return Promise.resolve({ ...BOT1, botActive: false })
      if (where.id === 'bot2') return Promise.resolve(BOT2)
      return Promise.resolve(null)
    })

    const res = await request(buildApp()).post('/').send({ bot1Id: 'bot1', bot2Id: 'bot2' })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain(BOT1.displayName)
  })

  it('returns 201 with slug and displayName on success', async () => {
    const res = await request(buildApp()).post('/').send({ bot1Id: 'bot1', bot2Id: 'bot2' })
    expect(res.status).toBe(201)
    expect(res.body.slug).toBe('game-slug')
    expect(res.body.displayName).toBe('Alpha vs Beta')
    expect(botGameRunner.startGame).toHaveBeenCalledWith({
      bot1: BOT1,
      bot2: BOT2,
      moveDelayMs: undefined,
    })
  })
})

describe('GET /', () => {
  it('returns 200 with an array of games', async () => {
    const games = [{ slug: 'g1', displayName: 'Alpha vs Beta' }]
    botGameRunner.listGames.mockReturnValue(games)

    const res = await request(buildApp()).get('/')
    expect(res.status).toBe(200)
    expect(res.body.games).toEqual(games)
  })

  it('returns 200 with empty array when no games are active', async () => {
    botGameRunner.listGames.mockReturnValue([])

    const res = await request(buildApp()).get('/')
    expect(res.status).toBe(200)
    expect(res.body.games).toEqual([])
  })
})

describe('GET /:slug', () => {
  const GAME = {
    slug: 'game-slug',
    displayName: 'Alpha vs Beta',
    board: Array(9).fill(null),
    currentTurn: 'X',
    status: 'playing',
    winner: null,
    winLine: null,
    spectatorIds: new Set(['s1']),
    bot1: { displayName: 'Alpha' },
    bot2: { displayName: 'Beta' },
  }

  it('returns 200 with game data when found', async () => {
    botGameRunner.getGame.mockReturnValue(GAME)

    const res = await request(buildApp()).get('/game-slug')
    expect(res.status).toBe(200)
    expect(res.body.game.slug).toBe('game-slug')
    expect(res.body.game.displayName).toBe('Alpha vs Beta')
    expect(res.body.game.isBotGame).toBe(true)
    expect(res.body.game.spectatorCount).toBe(1)
    expect(res.body.game.bot1).toEqual({ displayName: 'Alpha', mark: 'X' })
    expect(res.body.game.bot2).toEqual({ displayName: 'Beta', mark: 'O' })
    expect(botGameRunner.getGame).toHaveBeenCalledWith('game-slug')
  })

  it('returns 404 when the game is not found', async () => {
    botGameRunner.getGame.mockReturnValue(null)

    const res = await request(buildApp()).get('/no-such-game')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/Bot game not found/)
  })
})
