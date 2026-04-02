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
  mLModel: {
    delete: vi.fn(),
  },
  $transaction: vi.fn(),
}

vi.mock('../../lib/db.js', () => ({ default: mockDb }))

vi.mock('../../services/userService.js', () => ({
  listBots: vi.fn(),
  createBot: vi.fn(),
}))

vi.mock('../../services/mlService.js', () => ({
  getSystemConfig: vi.fn(),
}))

vi.mock('../../utils/cache.js', () => ({
  default: { get: vi.fn(), set: vi.fn(), invalidate: vi.fn() },
}))

// hasRole from ../../utils/roles.js is NOT mocked — runs real

const botsRouter = (await import('../bots.js')).default
const { listBots, createBot } = await import('../../services/userService.js')
const { getSystemConfig } = await import('../../services/mlService.js')
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
    getSystemConfig
      .mockResolvedValueOnce(5)   // bots.defaultBotLimit
      .mockResolvedValueOnce(5)   // bots.provisionalGames

    const res = await request(app).get('/api/v1/bots?ownerId=usr_1')

    expect(res.status).toBe(200)
    expect(res.body.bots).toEqual(bots)
    expect(res.body.limitInfo).toEqual({ count: 2, limit: 5, isExempt: false })
    expect(res.body.provisionalThreshold).toBe(5)
  })

  it('ownerId query with BOT_ADMIN owner → limit=null, isExempt=true', async () => {
    const bots = [mockBot]
    const owner = {
      id: 'usr_1',
      botLimit: null,
      userRoles: [{ role: 'BOT_ADMIN' }],
    }
    listBots.mockResolvedValue(bots)
    mockDb.user.findUnique.mockResolvedValue(owner)
    mockDb.user.count.mockResolvedValue(10)
    getSystemConfig
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)

    const res = await request(app).get('/api/v1/bots?ownerId=usr_1')

    expect(res.status).toBe(200)
    expect(res.body.limitInfo).toEqual({ count: 10, limit: null, isExempt: true })
  })

  it('ownerId query with custom botLimit on owner uses that limit', async () => {
    const bots = []
    const owner = {
      id: 'usr_1',
      botLimit: 10,
      userRoles: [],
    }
    listBots.mockResolvedValue(bots)
    mockDb.user.findUnique.mockResolvedValue(owner)
    mockDb.user.count.mockResolvedValue(1)
    getSystemConfig
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)

    const res = await request(app).get('/api/v1/bots?ownerId=usr_1')

    expect(res.status).toBe(200)
    expect(res.body.limitInfo.limit).toBe(10)
  })

  it('ownerId for unknown owner → isExempt=false, limit=defaultLimit', async () => {
    listBots.mockResolvedValue([])
    mockDb.user.findUnique.mockResolvedValue(null)
    mockDb.user.count.mockResolvedValue(0)
    getSystemConfig
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)

    const res = await request(app).get('/api/v1/bots?ownerId=unknown')

    expect(res.status).toBe(200)
    expect(res.body.limitInfo.isExempt).toBe(false)
    expect(res.body.limitInfo.limit).toBe(5)
  })

  it('includeInactive=true is passed through to listBots', async () => {
    cache.get.mockReturnValue(null)
    listBots.mockResolvedValue([])

    await request(app).get('/api/v1/bots?includeInactive=true')

    expect(listBots).toHaveBeenCalledWith({ includeInactive: true })
  })
})

// ─── POST / ──────────────────────────────────────────────────────────────────

describe('POST /api/v1/bots', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates bot successfully → 201 with bot', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCaller)
    mockDb.user.count.mockResolvedValue(0)
    getSystemConfig.mockResolvedValue(5)
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
  })

  it('user not found → 404', async () => {
    mockDb.user.findUnique.mockResolvedValue(null)

    const res = await request(app).post('/api/v1/bots').send({ name: 'Bot' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('User not found')
  })

  it('bot limit reached → 409 with BOT_LIMIT_REACHED code', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCaller)
    getSystemConfig.mockResolvedValue(5)
    mockDb.user.count.mockResolvedValue(5)

    const res = await request(app).post('/api/v1/bots').send({ name: 'Bot' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('BOT_LIMIT_REACHED')
  })

  it('BOT_ADMIN bypasses limit check and creates bot', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCallerBotAdmin)
    const newBot = { id: 'bot_admin', displayName: 'AdminBot' }
    createBot.mockResolvedValue(newBot)

    const res = await request(app).post('/api/v1/bots').send({ name: 'AdminBot' })

    expect(res.status).toBe(201)
    expect(mockDb.user.count).not.toHaveBeenCalled()
    expect(getSystemConfig).not.toHaveBeenCalled()
  })

  it('createBot throws RESERVED_NAME → 400', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCaller)
    getSystemConfig.mockResolvedValue(5)
    mockDb.user.count.mockResolvedValue(0)
    const err = new Error('Reserved name'); err.code = 'RESERVED_NAME'
    createBot.mockRejectedValue(err)

    const res = await request(app).post('/api/v1/bots').send({ name: 'rusty' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('RESERVED_NAME')
  })

  it('createBot throws PROFANITY → 400', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCaller)
    getSystemConfig.mockResolvedValue(5)
    mockDb.user.count.mockResolvedValue(0)
    const err = new Error('Profanity'); err.code = 'PROFANITY'
    createBot.mockRejectedValue(err)

    const res = await request(app).post('/api/v1/bots').send({ name: 'badword' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('PROFANITY')
  })

  it('createBot throws INVALID_NAME → 400', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCaller)
    getSystemConfig.mockResolvedValue(5)
    mockDb.user.count.mockResolvedValue(0)
    const err = new Error('Invalid name'); err.code = 'INVALID_NAME'
    createBot.mockRejectedValue(err)

    const res = await request(app).post('/api/v1/bots').send({ name: '!!!' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_NAME')
  })

  it('createBot throws INVALID_ALGORITHM → 400', async () => {
    mockDb.user.findUnique.mockResolvedValue(mockCaller)
    getSystemConfig.mockResolvedValue(5)
    mockDb.user.count.mockResolvedValue(0)
    const err = new Error('Invalid algorithm'); err.code = 'INVALID_ALGORITHM'
    createBot.mockRejectedValue(err)

    const res = await request(app).post('/api/v1/bots').send({ name: 'Bot' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_ALGORITHM')
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
    mockDb.$transaction.mockResolvedValue([])

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

  it('deletes bot (no model) → 204', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return mockCaller
      if (where.id === 'bot_1') return mockBot  // botModelId: null
      return null
    })
    mockDb.$transaction.mockResolvedValue(undefined)

    const res = await request(app).delete('/api/v1/bots/bot_1')

    expect(res.status).toBe(204)
    expect(mockDb.$transaction).toHaveBeenCalled()
    expect(mockDb.mLModel.delete).not.toHaveBeenCalled()
    expect(cache.invalidate).toHaveBeenCalledWith('bots:public')
  })

  it('deletes bot with model → also attempts model deletion', async () => {
    const botWithModel = { ...mockBot, botModelId: 'model_1' }
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.betterAuthId) return mockCaller
      if (where.id === 'bot_1') return botWithModel
      return null
    })
    mockDb.$transaction.mockResolvedValue(undefined)
    mockDb.mLModel.delete.mockResolvedValue({})

    const res = await request(app).delete('/api/v1/bots/bot_1')

    expect(res.status).toBe(204)
    expect(mockDb.mLModel.delete).toHaveBeenCalledWith({ where: { id: 'model_1' } })
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
