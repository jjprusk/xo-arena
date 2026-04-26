import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.auth = { userId: 'ba_user_1' }; next() },
}))

const mockDb = {
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  userEloHistory: {
    deleteMany: vi.fn(),
  },
  game: {
    deleteMany: vi.fn(),
  },
  botSkill: {
    delete: vi.fn(),
  },
  gameElo: {
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
}

vi.mock('../../lib/db.js', () => ({ default: mockDb }))

vi.mock('../../services/userService.js', () => ({
  listBots: vi.fn(),
  createBot: vi.fn(),
}))

vi.mock('../../services/skillService.js', () => ({
  getSystemConfig: vi.fn(),
}))

vi.mock('../../services/creditService.js', () => ({
  getTierLimit: vi.fn(),
}))

vi.mock('../../utils/cache.js', () => ({
  default: { get: vi.fn(), set: vi.fn(), invalidate: vi.fn() },
}))

// hasRole from ../../utils/roles.js is NOT mocked — runs real

const botsRouter = (await import('../bots.js')).default
const { listBots, createBot } = await import('../../services/userService.js')
const { getSystemConfig } = await import('../../services/skillService.js')
const { getTierLimit } = await import('../../services/creditService.js')
const cache = (await import('../../utils/cache.js')).default

const app = express()
app.use(express.json())
app.use('/api/v1/bots', botsRouter)

// ─── Fixture helpers ─────────────────────────────────────────────────────────

const mockCaller = {
  id: 'usr_1',
  betterAuthId: 'ba_user_1',
  displayName: 'Test User',
  botLimit: null,
  userRoles: [],
}

const mockCallerBotAdmin = {
  ...mockCaller,
  userRoles: [{ role: 'BOT_ADMIN' }],
}

const mockBot = {
  id: 'bot_1',
  displayName: 'MyBot',
  botOwnerId: 'usr_1',
  botActive: true,
  botInTournament: false,
  botModelType: 'ml',
  botModelId: null,
  isBot: true,
}

// ─── GET / ───────────────────────────────────────────────────────────────────

describe('GET /api/v1/bots', () => {
  beforeEach(() => vi.clearAllMocks())

  it('cache MISS → fetches from listBots, sets cache, returns bots with X-Cache: MISS', async () => {
    const bots = [{ id: 'bot_1', displayName: 'MyBot' }]
    cache.get.mockReturnValue(null)
    listBots.mockResolvedValue(bots)

    const res = await request(app).get('/api/v1/bots')

    expect(res.status).toBe(200)
    expect(res.body.bots).toEqual(bots)
    expect(res.headers['x-cache']).toBe('MISS')
    expect(cache.set).toHaveBeenCalledWith('bots:public', bots, 60_000)
  })

  it('cache HIT → returns cached bots with X-Cache: HIT, no listBots call', async () => {
    const bots = [{ id: 'bot_1', displayName: 'CachedBot' }]
    cache.get.mockReturnValue(bots)

    const res = await request(app).get('/api/v1/bots')

    expect(res.status).toBe(200)
    expect(res.body.bots).toEqual(bots)
    expect(res.headers['x-cache']).toBe('HIT')
    expect(listBots).not.toHaveBeenCalled()
    expect(mockDb.user.findUnique).not.toHaveBeenCalled()
  })

  it('ownerId query → returns bots + limitInfo for normal user (isExempt=false)', async () => {
    const bots = [mockBot]
    const owner = {
      id: 'usr_1',
      botLimit: null,
      userRoles: [],
    }
    listBots.mockResolvedValue(bots)
    mockDb.user.findUnique.mockResolvedValue(owner)
    mockDb.user.count.mockResolvedValue(2)
    getSystemConfig.mockResolvedValue(5)   // bots.provisionalGames
    getTierLimit.mockResolvedValue(5)       // tier-derived bot limit

    const res = await request(app).get('/api/v1/bots?ownerId=usr_1')

    expect(res.status).toBe(200)
    expect(res.body.bots).toEqual(bots)
    expect(res.body.limitInfo).toEqual({ count: 2, limit: 5, isExempt: false })
    expect(res.body.provisionalThreshold).toBe(5)
  })

  it('ownerId query with BOT_ADMIN owner → limit=null, isExempt=true (getTierLimit not called)', async () => {
    const bots = [mockBot]
    const owner = {
      id: 'usr_1',
      botLimit: null,
      userRoles: [{ role: 'BOT_ADMIN' }],
    }
    listBots.mockResolvedValue(bots)
    mockDb.user.findUnique.mockResolvedValue(owner)
    mockDb.user.count.mockResolvedValue(10)
    getSystemConfig.mockResolvedValue(5)  // bots.provisionalGames

    const res = await request(app).get('/api/v1/bots?ownerId=usr_1')

    expect(res.status).toBe(200)
    expect(res.body.limitInfo).toEqual({ count: 10, limit: null, isExempt: true })
    expect(getTierLimit).not.toHaveBeenCalled()
  })

  it('ownerId query: getTierLimit is called and its result used as limit', async () => {
    const bots = []
    const owner = { id: 'usr_1', botLimit: null, userRoles: [] }
    listBots.mockResolvedValue(bots)
    mockDb.user.findUnique.mockResolvedValue(owner)
    mockDb.user.count.mockResolvedValue(1)
    getSystemConfig.mockResolvedValue(5)
    getTierLimit.mockResolvedValue(8)   // e.g. Gold tier

    const res = await request(app).get('/api/v1/bots?ownerId=usr_1')

    expect(res.status).toBe(200)
    expect(res.body.limitInfo.limit).toBe(8)
    expect(getTierLimit).toHaveBeenCalledWith('usr_1', 'bots')
  })

  it('ownerId for unknown owner → isExempt=false, limit=3 (Bronze fallback, getTierLimit not called)', async () => {
    listBots.mockResolvedValue([])
    mockDb.user.findUnique.mockResolvedValue(null)
    mockDb.user.count.mockResolvedValue(0)
    getSystemConfig.mockResolvedValue(5)  // bots.provisionalGames

    const res = await request(app).get('/api/v1/bots?ownerId=unknown')

    expect(res.status).toBe(200)
    expect(res.body.limitInfo.isExempt).toBe(false)
    expect(res.body.limitInfo.limit).toBe(3)
    expect(getTierLimit).not.toHaveBeenCalled()
  })

  it('gameId filter → returns only bots that have a BotSkill for that game; bypasses cache', async () => {
    mockDb.botSkill.findMany = vi.fn().mockResolvedValue([
      { botId: 'bot_xo_a' },
      { botId: 'bot_xo_b' },
    ])
    listBots.mockResolvedValue([
      { id: 'bot_xo_a', displayName: 'A' },
      { id: 'bot_xo_b', displayName: 'B' },
      { id: 'bot_other', displayName: 'C' },
    ])
    cache.get.mockReturnValue('SHOULD-NOT-BE-USED')

    const res = await request(app).get('/api/v1/bots?gameId=xo')

    expect(res.status).toBe(200)
    expect(res.body.bots).toHaveLength(2)
    expect(res.body.bots.map(b => b.id)).toEqual(['bot_xo_a', 'bot_xo_b'])
    expect(mockDb.botSkill.findMany).toHaveBeenCalledWith({
      where:    { gameId: 'xo', botId: { not: null } },
      select:   { botId: true },
      distinct: ['botId'],
    })
    // Cache untouched
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('gameId filter with no matching skills → empty list, listBots not called', async () => {
    mockDb.botSkill.findMany = vi.fn().mockResolvedValue([])

    const res = await request(app).get('/api/v1/bots?gameId=connect4')

    expect(res.status).toBe(200)
    expect(res.body.bots).toEqual([])
    expect(listBots).not.toHaveBeenCalled()
  })

  it('includeInactive=true is passed through to listBots', async () => {
    cache.get.mockReturnValue(null)
    listBots.mockResolvedValue([])

    await request(app).get('/api/v1/bots?includeInactive=true')

    expect(listBots).toHaveBeenCalledWith({ includeInactive: true })
  })
})

// ─── GET /:id ────────────────────────────────────────────────────────────────

describe('GET /api/v1/bots/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.botSkill.findMany = vi.fn()
    mockDb.gameElo.findMany  = vi.fn()
  })

  function arrangeBot(bot) {
    mockDb.user.findUnique.mockImplementation(async ({ where }) => (where.id === bot.id ? bot : null))
  }

  it('returns bot with skills array enriched by per-skill ELO', async () => {
    arrangeBot({
      id: 'bot_1', displayName: 'Rusty', avatarUrl: null,
      isBot: true, botActive: true, botAvailable: true, botCompetitive: true,
      botProvisional: false, botGamesPlayed: 12,
      botModelId: 'skill_xo', botModelType: 'minimax', botOwnerId: null,
      createdAt: new Date('2026-04-01'),
    })
    mockDb.botSkill.findMany.mockResolvedValue([
      { id: 'skill_xo',       botId: 'bot_1', gameId: 'xo',       algorithm: 'minimax', createdAt: new Date('2026-04-01') },
      { id: 'skill_connect4', botId: 'bot_1', gameId: 'connect4', algorithm: 'minimax', createdAt: new Date('2026-04-15') },
    ])
    mockDb.gameElo.findMany.mockResolvedValue([
      { gameId: 'xo',       rating: 1450, gamesPlayed: 12 },
      { gameId: 'connect4', rating: 1200, gamesPlayed: 0  },
    ])

    const res = await request(app).get('/api/v1/bots/bot_1')

    expect(res.status).toBe(200)
    expect(res.body.bot.id).toBe('bot_1')
    expect(res.body.bot.skills).toHaveLength(2)
    expect(res.body.bot.skills[0].elo).toEqual({ gameId: 'xo', rating: 1450, gamesPlayed: 12 })
    expect(res.body.bot.skills[1].elo).toEqual({ gameId: 'connect4', rating: 1200, gamesPlayed: 0 })
  })

  it('skill without a matching ELO row → elo: null (not crashed)', async () => {
    arrangeBot({
      id: 'bot_2', displayName: 'NewBot', avatarUrl: null,
      isBot: true, botActive: true, botAvailable: true, botCompetitive: false,
      botProvisional: true, botGamesPlayed: 0,
      botModelId: 'skill_xo', botModelType: 'minimax', botOwnerId: 'usr_1',
      createdAt: new Date(),
    })
    mockDb.botSkill.findMany.mockResolvedValue([
      { id: 'skill_xo', botId: 'bot_2', gameId: 'xo', algorithm: 'minimax' },
    ])
    mockDb.gameElo.findMany.mockResolvedValue([])

    const res = await request(app).get('/api/v1/bots/bot_2')

    expect(res.status).toBe(200)
    expect(res.body.bot.skills).toHaveLength(1)
    expect(res.body.bot.skills[0].elo).toBeNull()
  })

  it('bot with no skills → skills: [] (no GameElo query needed)', async () => {
    arrangeBot({
      id: 'bot_3', displayName: 'Skillless', avatarUrl: null,
      isBot: true, botActive: true, botAvailable: false, botCompetitive: false,
      botProvisional: true, botGamesPlayed: 0,
      botModelId: null, botModelType: null, botOwnerId: 'usr_1',
      createdAt: new Date(),
    })
    mockDb.botSkill.findMany.mockResolvedValue([])

    const res = await request(app).get('/api/v1/bots/bot_3')

    expect(res.status).toBe(200)
    expect(res.body.bot.skills).toEqual([])
    expect(mockDb.gameElo.findMany).not.toHaveBeenCalled()
  })

  it('non-bot user → 404', async () => {
    arrangeBot({ id: 'usr_x', isBot: false, displayName: 'Real User' })

    const res = await request(app).get('/api/v1/bots/usr_x')

    expect(res.status).toBe(404)
  })

  it('unknown id → 404', async () => {
    mockDb.user.findUnique.mockResolvedValue(null)

    const res = await request(app).get('/api/v1/bots/missing')

    expect(res.status).toBe(404)
  })
})

// ─── POST / ──────────────────────────────────────────────────────────────────

describe('POST /api/v1/bots', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates bot successfully → 201 with bot', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCaller)
    mockDb.user.count.mockResolvedValue(0)
    getTierLimit.mockResolvedValue(5)
    const newBot = { id: 'bot_new', displayName: 'AlphaBot' }
    createBot.mockResolvedValue(newBot)

    const res = await request(app)
      .post('/api/v1/bots')
      .send({ name: 'AlphaBot', modelType: 'ml' })

    expect(res.status).toBe(201)
    expect(res.body.bot).toEqual(newBot)
    expect(cache.invalidate).toHaveBeenCalledWith('bots:public')
    // ownerBaId must be the BA user ID so the gym's ownership check passes
    expect(createBot).toHaveBeenCalledWith('usr_1', expect.objectContaining({ ownerBaId: 'ba_user_1' }))
    expect(getTierLimit).toHaveBeenCalledWith('usr_1', 'bots')
  })

  it('user not found → 404', async () => {
    mockDb.user.findUnique.mockResolvedValue(null)

    const res = await request(app).post('/api/v1/bots').send({ name: 'Bot' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('User not found')
  })

  it('bot limit reached → 409 with BOT_LIMIT_REACHED code', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCaller)
    getTierLimit.mockResolvedValue(3)    // Bronze tier: limit 3
    mockDb.user.count.mockResolvedValue(3)

    const res = await request(app).post('/api/v1/bots').send({ name: 'Bot' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('BOT_LIMIT_REACHED')
    expect(res.body.error).toContain('3')
  })

  it('Diamond tier (limit=0) allows creation even when count is high', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCaller)
    getTierLimit.mockResolvedValue(0)    // Diamond: unlimited
    mockDb.user.count.mockResolvedValue(99)
    const newBot = { id: 'bot_diamond', displayName: 'DiamondBot' }
    createBot.mockResolvedValue(newBot)

    const res = await request(app).post('/api/v1/bots').send({ name: 'DiamondBot' })

    expect(res.status).toBe(201)
    expect(res.body.bot).toEqual(newBot)
  })

  it('BOT_ADMIN bypasses limit check and creates bot', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCallerBotAdmin)
    const newBot = { id: 'bot_admin', displayName: 'AdminBot' }
    createBot.mockResolvedValue(newBot)

    const res = await request(app).post('/api/v1/bots').send({ name: 'AdminBot' })

    expect(res.status).toBe(201)
    expect(mockDb.user.count).not.toHaveBeenCalled()
    expect(getTierLimit).not.toHaveBeenCalled()
  })

  it('createBot throws RESERVED_NAME → 400', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCaller)
    getTierLimit.mockResolvedValue(5)
    mockDb.user.count.mockResolvedValue(0)
    const err = new Error('Reserved name'); err.code = 'RESERVED_NAME'
    createBot.mockRejectedValue(err)

    const res = await request(app).post('/api/v1/bots').send({ name: 'rusty' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('RESERVED_NAME')
  })

  it('createBot throws PROFANITY → 400', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCaller)
    getTierLimit.mockResolvedValue(5)
    mockDb.user.count.mockResolvedValue(0)
    const err = new Error('Profanity'); err.code = 'PROFANITY'
    createBot.mockRejectedValue(err)

    const res = await request(app).post('/api/v1/bots').send({ name: 'badword' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('PROFANITY')
  })

  it('createBot throws INVALID_NAME → 400', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCaller)
    getTierLimit.mockResolvedValue(5)
    mockDb.user.count.mockResolvedValue(0)
    const err = new Error('Invalid name'); err.code = 'INVALID_NAME'
    createBot.mockRejectedValue(err)

    const res = await request(app).post('/api/v1/bots').send({ name: '!!!' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_NAME')
  })

  it('createBot throws INVALID_ALGORITHM → 400', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCaller)
    getTierLimit.mockResolvedValue(5)
    mockDb.user.count.mockResolvedValue(0)
    const err = new Error('Invalid algorithm'); err.code = 'INVALID_ALGORITHM'
    createBot.mockRejectedValue(err)

    const res = await request(app).post('/api/v1/bots').send({ name: 'Bot' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_ALGORITHM')
  })

  // Phase 3.7a.2: hybrid displayName uniqueness. Prisma P2002 from either
  // partial unique index must translate to BOT_NAME_TAKEN (409). Other
  // unique-constraint collisions (e.g. email) fall through to the generic
  // error handler and are not mis-reported as name collisions.
  it('createBot hits the partial unique index → 409 BOT_NAME_TAKEN (per-owner)', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCaller)
    getTierLimit.mockResolvedValue(5)
    mockDb.user.count.mockResolvedValue(0)
    const err = new Error('Unique violation')
    err.code = 'P2002'
    err.meta = { target: 'users_bot_displayname_by_owner_key' }
    createBot.mockRejectedValue(err)

    const res = await request(app).post('/api/v1/bots').send({ name: 'Rusty' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('BOT_NAME_TAKEN')
  })

  it('createBot hits the unowned-bot unique index → 409 BOT_NAME_TAKEN (built-in collision)', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCaller)
    getTierLimit.mockResolvedValue(5)
    mockDb.user.count.mockResolvedValue(0)
    const err = new Error('Unique violation')
    err.code = 'P2002'
    err.meta = { target: 'users_bot_displayname_unowned_key' }
    createBot.mockRejectedValue(err)

    const res = await request(app).post('/api/v1/bots').send({ name: 'Rusty' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('BOT_NAME_TAKEN')
  })

  it('P2002 on a NON-name column (e.g. email) falls through to the generic handler — not mis-reported as BOT_NAME_TAKEN', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCaller)
    getTierLimit.mockResolvedValue(5)
    mockDb.user.count.mockResolvedValue(0)
    const err = new Error('Unique violation')
    err.code = 'P2002'
    err.meta = { target: ['email'] }
    createBot.mockRejectedValue(err)

    const res = await request(app).post('/api/v1/bots').send({ name: 'Bot' })

    expect(res.body.code).not.toBe('BOT_NAME_TAKEN')
  })
})

// ─── PATCH /:id ──────────────────────────────────────────────────────────────

describe('PATCH /api/v1/bots/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  function setupPatchMocks({ caller = mockCaller, bot = mockBot } = {}) {
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return caller
      if (where.id === 'bot_1') return bot
      return null
    })
  }

  it('renames bot successfully → 200 with updated bot', async () => {
    setupPatchMocks()
    mockDb.user.findFirst.mockResolvedValue(null) // no name conflict
    getSystemConfig.mockResolvedValue([])         // empty profanity list
    const updated = { ...mockBot, displayName: 'NewName' }
    mockDb.user.update.mockResolvedValue(updated)

    const res = await request(app)
      .patch('/api/v1/bots/bot_1')
      .send({ displayName: 'NewName' })

    expect(res.status).toBe(200)
    expect(res.body.bot.displayName).toBe('NewName')
    expect(cache.invalidate).toHaveBeenCalledWith('bots:public')
  })

  it('empty displayName → 400', async () => {
    setupPatchMocks()

    const res = await request(app)
      .patch('/api/v1/bots/bot_1')
      .send({ displayName: '   ' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/empty/i)
  })

  it('reserved name → 400 RESERVED_NAME', async () => {
    setupPatchMocks()
    getSystemConfig.mockResolvedValue([])

    const res = await request(app)
      .patch('/api/v1/bots/bot_1')
      .send({ displayName: 'Rusty' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('RESERVED_NAME')
  })

  it('profanity name → 400 PROFANITY', async () => {
    setupPatchMocks()
    getSystemConfig.mockResolvedValue(['badword'])

    const res = await request(app)
      .patch('/api/v1/bots/bot_1')
      .send({ displayName: 'mybadwordbot' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('PROFANITY')
  })

  it('name taken → 409 NAME_TAKEN', async () => {
    setupPatchMocks()
    getSystemConfig.mockResolvedValue([])
    // conflict found (different bot with same name)
    mockDb.user.findFirst.mockResolvedValue({ id: 'bot_other', displayName: 'TakenName' })

    const res = await request(app)
      .patch('/api/v1/bots/bot_1')
      .send({ displayName: 'TakenName' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('NAME_TAKEN')
  })

  it('same name (case-insensitive) does not trigger conflict check', async () => {
    // Bot already named 'MyBot'; sending 'mybot' should not check for conflicts
    setupPatchMocks()
    getSystemConfig.mockResolvedValue([])
    const updated = { ...mockBot, displayName: 'mybot' }
    mockDb.user.update.mockResolvedValue(updated)

    const res = await request(app)
      .patch('/api/v1/bots/bot_1')
      .send({ displayName: 'mybot' })

    expect(res.status).toBe(200)
    expect(mockDb.user.findFirst).not.toHaveBeenCalled()
  })

  it('toggles botActive → 200', async () => {
    setupPatchMocks()
    const updated = { ...mockBot, botActive: false }
    mockDb.user.update.mockResolvedValue(updated)

    const res = await request(app)
      .patch('/api/v1/bots/bot_1')
      .send({ botActive: false })

    expect(res.status).toBe(200)
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ botActive: false }) })
    )
  })

  it('nothing to update → 400', async () => {
    setupPatchMocks()

    const res = await request(app)
      .patch('/api/v1/bots/bot_1')
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/nothing/i)
  })

  it('bot not found → 404', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return mockCaller
      return null // bot lookup fails
    })

    const res = await request(app)
      .patch('/api/v1/bots/bot_1')
      .send({ botActive: true })

    expect(res.status).toBe(404)
  })

  it('caller is not owner and not BOT_ADMIN → 403', async () => {
    const otherBot = { ...mockBot, botOwnerId: 'usr_other' }
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return mockCaller // caller is usr_1, not BOT_ADMIN
      if (where.id === 'bot_1') return otherBot
      return null
    })

    const res = await request(app)
      .patch('/api/v1/bots/bot_1')
      .send({ botActive: true })

    expect(res.status).toBe(403)
  })

  it('BOT_ADMIN can edit bot they do not own → 200', async () => {
    const otherBot = { ...mockBot, botOwnerId: 'usr_other' }
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return mockCallerBotAdmin
      if (where.id === 'bot_1') return otherBot
      return null
    })
    getSystemConfig.mockResolvedValue([])
    mockDb.user.findFirst.mockResolvedValue(null)
    mockDb.user.update.mockResolvedValue({ ...otherBot, displayName: 'Renamed' })

    const res = await request(app)
      .patch('/api/v1/bots/bot_1')
      .send({ displayName: 'Renamed' })

    expect(res.status).toBe(200)
  })
})

// ─── POST /:id/reset-elo ─────────────────────────────────────────────────────

describe('POST /api/v1/bots/:id/reset-elo', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resets ELO successfully → { ok: true }', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return mockCaller
      if (where.id === 'bot_1') return mockBot
      return null
    })
    mockDb.gameElo.upsert.mockResolvedValue({})
    mockDb.user.update.mockResolvedValue({})
    mockDb.$transaction.mockImplementation(async (ops) => Promise.all(ops))

    const res = await request(app).post('/api/v1/bots/bot_1/reset-elo')

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(mockDb.$transaction).toHaveBeenCalled()
  })

  it('bot in tournament → 409 BOT_IN_TOURNAMENT', async () => {
    const tournamentBot = { ...mockBot, botInTournament: true }
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return mockCaller
      if (where.id === 'bot_1') return tournamentBot
      return null
    })

    const res = await request(app).post('/api/v1/bots/bot_1/reset-elo')

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('BOT_IN_TOURNAMENT')
  })

  it('bot not found → 404', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return mockCaller
      return null
    })

    const res = await request(app).post('/api/v1/bots/bot_1/reset-elo')

    expect(res.status).toBe(404)
  })

  it('caller not owner and not BOT_ADMIN → 403', async () => {
    const otherBot = { ...mockBot, botOwnerId: 'usr_other' }
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return mockCaller
      if (where.id === 'bot_1') return otherBot
      return null
    })

    const res = await request(app).post('/api/v1/bots/bot_1/reset-elo')

    expect(res.status).toBe(403)
  })
})

// ─── DELETE /:id ─────────────────────────────────────────────────────────────

describe('DELETE /api/v1/bots/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes bot (no model) → 204, sweeps botId-scoped skills, no id-scoped sweep', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return mockCaller
      if (where.id === 'bot_1') return mockBot  // botModelId: null
      return null
    })
    const txSkillDeleteMany = vi.fn().mockResolvedValue({ count: 0 })
    mockDb.$transaction.mockImplementation(async (fn) =>
      fn({ game: mockDb.game, user: mockDb.user, botSkill: { deleteMany: txSkillDeleteMany } })
    )

    const res = await request(app).delete('/api/v1/bots/bot_1')

    expect(res.status).toBe(204)
    expect(mockDb.$transaction).toHaveBeenCalled()
    // botId sweep always runs; id-scoped sweep only when botModelId set
    expect(txSkillDeleteMany).toHaveBeenCalledTimes(1)
    expect(txSkillDeleteMany).toHaveBeenCalledWith({ where: { botId: 'bot_1' } })
    expect(cache.invalidate).toHaveBeenCalledWith('bots:public')
  })

  it('deletes bot with model → both botId and id sweeps run inside transaction', async () => {
    const botWithModel = { ...mockBot, botModelId: 'model_1' }
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return mockCaller
      if (where.id === 'bot_1') return botWithModel
      return null
    })
    const txSkillDeleteMany = vi.fn().mockResolvedValue({ count: 1 })
    mockDb.$transaction.mockImplementation(async (fn) =>
      fn({ game: mockDb.game, user: mockDb.user, botSkill: { deleteMany: txSkillDeleteMany } })
    )

    const res = await request(app).delete('/api/v1/bots/bot_1')

    expect(res.status).toBe(204)
    expect(txSkillDeleteMany).toHaveBeenCalledWith({ where: { botId: 'bot_1' } })
    expect(txSkillDeleteMany).toHaveBeenCalledWith({ where: { id: 'model_1' } })
  })

  it('bot not found → 404', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return mockCaller
      return null
    })

    const res = await request(app).delete('/api/v1/bots/bot_1')

    expect(res.status).toBe(404)
  })

  it('P2025 from transaction → 404', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return mockCaller
      if (where.id === 'bot_1') return mockBot
      return null
    })
    const p2025 = new Error('Record not found'); p2025.code = 'P2025'
    mockDb.$transaction.mockRejectedValue(p2025)

    const res = await request(app).delete('/api/v1/bots/bot_1')

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })

  it('caller not owner and not BOT_ADMIN → 403', async () => {
    const otherBot = { ...mockBot, botOwnerId: 'usr_other' }
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return mockCaller
      if (where.id === 'bot_1') return otherBot
      return null
    })

    const res = await request(app).delete('/api/v1/bots/bot_1')

    expect(res.status).toBe(403)
  })
})

// ─── POST /:id/skills ─────────────────────────────────────────────────────────

describe('POST /api/v1/bots/:id/skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.botSkill.findFirst = vi.fn()
    mockDb.botSkill.create    = vi.fn()
  })

  function arrangeOwnedBot(overrides = {}) {
    const bot = { ...mockBot, ...overrides }
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return mockCaller
      if (where.id === bot.id) return bot
      return null
    })
    return bot
  }

  it('first skill on a skill-less bot → 201, sets botModelId, returns created:true', async () => {
    arrangeOwnedBot({ botModelId: null })
    mockDb.botSkill.findFirst.mockResolvedValue(null)
    const created = { id: 'skill_new', botId: 'bot_1', gameId: 'xo', algorithm: 'minimax' }
    mockDb.botSkill.create.mockResolvedValue(created)
    mockDb.user.update.mockResolvedValue({})

    const res = await request(app)
      .post('/api/v1/bots/bot_1/skills')
      .send({ gameId: 'xo', algorithm: 'minimax', modelType: 'minimax' })

    expect(res.status).toBe(201)
    expect(res.body.created).toBe(true)
    expect(res.body.skill).toEqual(created)
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { id: 'bot_1' },
      data:  { botModelId: 'skill_new', botModelType: 'minimax' },
    })
    expect(cache.invalidate).toHaveBeenCalledWith('bots:public')
  })

  it('idempotent: existing skill for (botId, gameId) → 200, created:false, no create, no botModelId update', async () => {
    arrangeOwnedBot({ botModelId: 'skill_old' })
    const existing = { id: 'skill_old', botId: 'bot_1', gameId: 'xo', algorithm: 'minimax' }
    mockDb.botSkill.findFirst.mockResolvedValue(existing)

    const res = await request(app)
      .post('/api/v1/bots/bot_1/skills')
      .send({ gameId: 'xo', algorithm: 'minimax' })

    expect(res.status).toBe(200)
    expect(res.body.created).toBe(false)
    expect(res.body.skill).toEqual(existing)
    expect(mockDb.botSkill.create).not.toHaveBeenCalled()
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it('second skill on a bot with existing primary → 201, does NOT repoint botModelId', async () => {
    arrangeOwnedBot({ botModelId: 'skill_xo' })
    mockDb.botSkill.findFirst.mockResolvedValue(null)
    mockDb.botSkill.create.mockResolvedValue({ id: 'skill_c4', botId: 'bot_1', gameId: 'connect4', algorithm: 'minimax' })

    const res = await request(app)
      .post('/api/v1/bots/bot_1/skills')
      .send({ gameId: 'connect4', algorithm: 'minimax' })

    expect(res.status).toBe(201)
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it('missing gameId → 400 INVALID_GAME_ID', async () => {
    arrangeOwnedBot()

    const res = await request(app)
      .post('/api/v1/bots/bot_1/skills')
      .send({ algorithm: 'minimax' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_GAME_ID')
    expect(mockDb.botSkill.create).not.toHaveBeenCalled()
  })

  it('unsupported algorithm → 400 INVALID_ALGORITHM', async () => {
    arrangeOwnedBot()

    const res = await request(app)
      .post('/api/v1/bots/bot_1/skills')
      .send({ gameId: 'xo', algorithm: 'bogus' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_ALGORITHM')
    expect(mockDb.botSkill.create).not.toHaveBeenCalled()
  })

  it('caller not owner and not BOT_ADMIN → 403, no create', async () => {
    arrangeOwnedBot({ botOwnerId: 'usr_other' })

    const res = await request(app)
      .post('/api/v1/bots/bot_1/skills')
      .send({ gameId: 'xo', algorithm: 'minimax' })

    expect(res.status).toBe(403)
    expect(mockDb.botSkill.create).not.toHaveBeenCalled()
  })

  it('bot not found → 404', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return mockCaller
      return null
    })

    const res = await request(app)
      .post('/api/v1/bots/bot_unknown/skills')
      .send({ gameId: 'xo', algorithm: 'minimax' })

    expect(res.status).toBe(404)
  })
})

// ─── DELETE /:id/skills/:skillId ──────────────────────────────────────────────

describe('DELETE /api/v1/bots/:id/skills/:skillId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.botSkill.findUnique = vi.fn()
    mockDb.botSkill.findFirst  = vi.fn()
    mockDb.botSkill.delete     = vi.fn()
  })

  function arrangeOwnedBot(overrides = {}) {
    const bot = { ...mockBot, ...overrides }
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return mockCaller
      if (where.id === bot.id) return bot
      return null
    })
    return bot
  }

  it('deletes a non-primary skill → 204, does NOT touch botModelId', async () => {
    arrangeOwnedBot({ botModelId: 'skill_xo' })
    mockDb.botSkill.findUnique.mockResolvedValue({ id: 'skill_c4', botId: 'bot_1', gameId: 'connect4' })

    const txDelete = vi.fn().mockResolvedValue({})
    const txFindFirst = vi.fn()
    const txUserUpdate = vi.fn()
    mockDb.$transaction.mockImplementation(async (fn) =>
      fn({
        botSkill: { delete: txDelete, findFirst: txFindFirst },
        user:     { update: txUserUpdate },
      })
    )

    const res = await request(app).delete('/api/v1/bots/bot_1/skills/skill_c4')

    expect(res.status).toBe(204)
    expect(txDelete).toHaveBeenCalledWith({ where: { id: 'skill_c4' } })
    expect(txUserUpdate).not.toHaveBeenCalled()
    expect(cache.invalidate).toHaveBeenCalledWith('bots:public')
  })

  it('deletes the primary skill, repoints botModelId to remaining skill', async () => {
    arrangeOwnedBot({ botModelId: 'skill_xo' })
    mockDb.botSkill.findUnique.mockResolvedValue({ id: 'skill_xo', botId: 'bot_1', gameId: 'xo' })

    const txDelete = vi.fn().mockResolvedValue({})
    const txFindFirst = vi.fn().mockResolvedValue({ id: 'skill_c4' })
    const txUserUpdate = vi.fn().mockResolvedValue({})
    mockDb.$transaction.mockImplementation(async (fn) =>
      fn({
        botSkill: { delete: txDelete, findFirst: txFindFirst },
        user:     { update: txUserUpdate },
      })
    )

    const res = await request(app).delete('/api/v1/bots/bot_1/skills/skill_xo')

    expect(res.status).toBe(204)
    expect(txDelete).toHaveBeenCalledWith({ where: { id: 'skill_xo' } })
    expect(txUserUpdate).toHaveBeenCalledWith({
      where: { id: 'bot_1' },
      data:  { botModelId: 'skill_c4' },
    })
  })

  it('deletes the only/primary skill, repoints botModelId to null', async () => {
    arrangeOwnedBot({ botModelId: 'skill_xo' })
    mockDb.botSkill.findUnique.mockResolvedValue({ id: 'skill_xo', botId: 'bot_1', gameId: 'xo' })

    const txDelete = vi.fn().mockResolvedValue({})
    const txFindFirst = vi.fn().mockResolvedValue(null)
    const txUserUpdate = vi.fn().mockResolvedValue({})
    mockDb.$transaction.mockImplementation(async (fn) =>
      fn({
        botSkill: { delete: txDelete, findFirst: txFindFirst },
        user:     { update: txUserUpdate },
      })
    )

    const res = await request(app).delete('/api/v1/bots/bot_1/skills/skill_xo')

    expect(res.status).toBe(204)
    expect(txUserUpdate).toHaveBeenCalledWith({
      where: { id: 'bot_1' },
      data:  { botModelId: null },
    })
  })

  it('skill belongs to a different bot → 404', async () => {
    arrangeOwnedBot({ botModelId: 'skill_xo' })
    mockDb.botSkill.findUnique.mockResolvedValue({ id: 'skill_other', botId: 'bot_other', gameId: 'xo' })

    const res = await request(app).delete('/api/v1/bots/bot_1/skills/skill_other')

    expect(res.status).toBe(404)
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('skill not found → 404', async () => {
    arrangeOwnedBot()
    mockDb.botSkill.findUnique.mockResolvedValue(null)

    const res = await request(app).delete('/api/v1/bots/bot_1/skills/missing')

    expect(res.status).toBe(404)
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('caller not owner and not BOT_ADMIN → 403', async () => {
    arrangeOwnedBot({ botOwnerId: 'usr_other' })

    const res = await request(app).delete('/api/v1/bots/bot_1/skills/skill_xo')

    expect(res.status).toBe(403)
  })
})
