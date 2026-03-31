import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// ─── Auth mock ────────────────────────────────────────────────────────────────

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.auth = { userId: 'ba_admin_1' }
    next()
  },
  requireAdmin: (_req, _res, next) => next(),
}))

// ─── DB mock ──────────────────────────────────────────────────────────────────

vi.mock('../../lib/db.js', () => {
  const user = {
    count:      vi.fn(),
    findMany:   vi.fn(),
    findUnique: vi.fn(),
    findFirst:  vi.fn(),
    update:     vi.fn(),
    delete:     vi.fn(),
  }
  const baUser = {
    findMany:   vi.fn(),
    findUnique: vi.fn(),
    update:     vi.fn(),
  }
  const game = {
    count:    vi.fn(),
    findMany: vi.fn(),
    delete:   vi.fn(),
    deleteMany: vi.fn(),
  }
  const mLModel = {
    count:      vi.fn(),
    findMany:   vi.fn(),
    findUnique: vi.fn(),
    update:     vi.fn(),
    delete:     vi.fn(),
  }
  const userRole = {
    create:     vi.fn(),
    deleteMany: vi.fn(),
  }
  const systemConfig = {
    findUnique: vi.fn(),
    upsert:     vi.fn(),
  }
  return {
    default: {
      user, baUser, game, mLModel, userRole, systemConfig,
      $transaction: vi.fn(async (fn) => fn({ game, user })),
    },
  }
})

// ─── mlService mock ───────────────────────────────────────────────────────────

vi.mock('../../services/mlService.js', () => ({
  deleteModel:     vi.fn(),
  getSystemConfig: vi.fn(),
  setSystemConfig: vi.fn(),
}))

const adminRouter = (await import('../admin.js')).default
const db = (await import('../../lib/db.js')).default
const { deleteModel, getSystemConfig, setSystemConfig } =
  await import('../../services/mlService.js')

const app = express()
app.use(express.json())
app.use('/api/v1/admin', adminRouter)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'usr_1',
  betterAuthId: 'ba_user_1',
  username: 'alice',
  displayName: 'Alice',
  email: 'alice@example.com',
  avatarUrl: null,
  eloRating: 1000,
  banned: false,
  mlModelLimit: null,
  createdAt: new Date().toISOString(),
  botLimit: 5,
  userRoles: [],
  _count: { gamesAsPlayer1: 3 },
}

const mockBaUser = { id: 'ba_user_1', role: null, emailVerified: true }

const mockBot = {
  id: 'bot_1',
  displayName: 'TestBot',
  avatarUrl: null,
  eloRating: 1000,
  botModelType: 'builtin',
  botModelId: 'builtin:minimax:novice',
  botActive: true,
  botAvailable: true,
  botCompetitive: false,
  botProvisional: false,
  botInTournament: false,
  botOwnerId: 'usr_1',
  createdAt: new Date().toISOString(),
  isBot: true,
}

const mockModel = {
  id: 'model_1',
  name: 'My Model',
  status: 'IDLE',
  featured: false,
  createdBy: 'ba_user_1',
  maxEpisodes: 1000,
  createdAt: new Date().toISOString(),
  _count: { sessions: 2 },
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── GET /admin/stats ─────────────────────────────────────────────────────────

describe('GET /api/v1/admin/stats', () => {
  it('returns platform metrics', async () => {
    db.user.count.mockResolvedValueOnce(42)   // totalUsers
      .mockResolvedValueOnce(5)               // bannedUsers
    db.game.count.mockResolvedValueOnce(200)  // totalGames
      .mockResolvedValueOnce(10)              // gamesToday
    db.mLModel.count.mockResolvedValueOnce(7) // totalModels

    const res = await request(app).get('/api/v1/admin/stats')

    expect(res.status).toBe(200)
    expect(res.body.stats).toMatchObject({
      totalUsers:  42,
      totalGames:  200,
      gamesToday:  10,
      bannedUsers: 5,
      totalModels: 7,
    })
  })
})

// ─── GET /admin/users ─────────────────────────────────────────────────────────

describe('GET /api/v1/admin/users', () => {
  it('returns paginated user list', async () => {
    db.user.findMany.mockResolvedValue([mockUser])
    db.user.count.mockResolvedValue(1)
    db.baUser.findMany.mockResolvedValue([mockBaUser])

    const res = await request(app).get('/api/v1/admin/users')

    expect(res.status).toBe(200)
    expect(res.body.users).toHaveLength(1)
    expect(res.body.users[0].displayName).toBe('Alice')
    expect(res.body.total).toBe(1)
    expect(res.body.page).toBe(1)
  })

  it('respects search query', async () => {
    db.user.findMany.mockResolvedValue([])
    db.user.count.mockResolvedValue(0)
    db.baUser.findMany.mockResolvedValue([])

    const res = await request(app).get('/api/v1/admin/users?search=bob')

    expect(res.status).toBe(200)
    expect(res.body.users).toHaveLength(0)
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.any(Array) }),
      })
    )
  })

  it('enriches users with baRole and emailVerified', async () => {
    db.user.findMany.mockResolvedValue([mockUser])
    db.user.count.mockResolvedValue(1)
    db.baUser.findMany.mockResolvedValue([{ id: 'ba_user_1', role: 'admin', emailVerified: true }])

    const res = await request(app).get('/api/v1/admin/users')

    expect(res.body.users[0].baRole).toBe('admin')
    expect(res.body.users[0].emailVerified).toBe(true)
  })
})

// ─── PATCH /admin/users/:id ───────────────────────────────────────────────────

describe('PATCH /api/v1/admin/users/:id', () => {
  it('bans a user', async () => {
    const banned = { ...mockUser, banned: true }
    db.user.update.mockResolvedValue(banned)
    db.baUser.findUnique.mockResolvedValue(mockBaUser)

    const res = await request(app)
      .patch('/api/v1/admin/users/usr_1')
      .send({ banned: true })

    expect(res.status).toBe(200)
    expect(res.body.user.banned).toBe(true)
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ banned: true }) })
    )
  })

  it('unbans a user', async () => {
    db.user.update.mockResolvedValue({ ...mockUser, banned: false })
    db.baUser.findUnique.mockResolvedValue(mockBaUser)

    const res = await request(app)
      .patch('/api/v1/admin/users/usr_1')
      .send({ banned: false })

    expect(res.status).toBe(200)
    expect(res.body.user.banned).toBe(false)
  })

  it('rejects invalid eloRating', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/users/usr_1')
      .send({ eloRating: 9999 })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/eloRating/)
  })

  it('rejects negative eloRating', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/users/usr_1')
      .send({ eloRating: -1 })

    expect(res.status).toBe(400)
  })

  it('updates eloRating within valid range', async () => {
    db.user.update.mockResolvedValue({ ...mockUser, eloRating: 1500 })
    db.baUser.findUnique.mockResolvedValue(mockBaUser)

    const res = await request(app)
      .patch('/api/v1/admin/users/usr_1')
      .send({ eloRating: 1500 })

    expect(res.status).toBe(200)
    expect(res.body.user.eloRating).toBe(1500)
  })

  it('rejects invalid mlModelLimit', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/users/usr_1')
      .send({ mlModelLimit: -5 })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/mlModelLimit/)
  })

  it('resets mlModelLimit to null', async () => {
    db.user.update.mockResolvedValue({ ...mockUser, mlModelLimit: null })
    db.baUser.findUnique.mockResolvedValue(mockBaUser)

    const res = await request(app)
      .patch('/api/v1/admin/users/usr_1')
      .send({ mlModelLimit: null })

    expect(res.status).toBe(200)
    expect(res.body.user.mlModelLimit).toBeNull()
  })

  it('grants a domain role', async () => {
    db.user.findUnique
      .mockResolvedValueOnce({ ...mockUser, userRoles: [] })       // initial fetch
      .mockResolvedValueOnce({ ...mockUser, userRoles: [{ role: 'BOT_ADMIN', grantedAt: new Date() }] }) // re-fetch after update
    db.userRole.create.mockResolvedValue({})
    db.baUser.findUnique.mockResolvedValue(mockBaUser)

    const res = await request(app)
      .patch('/api/v1/admin/users/usr_1')
      .send({ roles: ['BOT_ADMIN'] })

    expect(res.status).toBe(200)
    expect(db.userRole.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'BOT_ADMIN' }) })
    )
    expect(res.body.user.roles).toContain('BOT_ADMIN')
  })

  it('revokes a domain role', async () => {
    db.user.findUnique
      .mockResolvedValueOnce({ ...mockUser, userRoles: [{ role: 'BOT_ADMIN', grantedAt: new Date() }] })
      .mockResolvedValueOnce({ ...mockUser, userRoles: [] })
    db.userRole.deleteMany.mockResolvedValue({})
    db.baUser.findUnique.mockResolvedValue(mockBaUser)

    const res = await request(app)
      .patch('/api/v1/admin/users/usr_1')
      .send({ roles: [] })

    expect(res.status).toBe(200)
    expect(db.userRole.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ role: 'BOT_ADMIN' }) })
    )
  })

  it('rejects invalid baRole', async () => {
    db.user.findUnique.mockResolvedValue(mockUser)
    db.baUser.findUnique.mockResolvedValue(mockBaUser)

    const res = await request(app)
      .patch('/api/v1/admin/users/usr_1')
      .send({ baRole: 'superuser' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/baRole/)
  })

  it('promotes user to BA admin', async () => {
    db.user.findUnique.mockResolvedValue(mockUser)
    db.baUser.update.mockResolvedValue({ role: 'admin', emailVerified: true })

    const res = await request(app)
      .patch('/api/v1/admin/users/usr_1')
      .send({ baRole: 'admin' })

    expect(res.status).toBe(200)
    expect(res.body.user.baRole).toBe('admin')
  })

  it('returns 404 for missing user (Prisma P2025)', async () => {
    const err = new Error('Not found')
    err.code = 'P2025'
    db.user.update.mockRejectedValue(err)

    const res = await request(app)
      .patch('/api/v1/admin/users/nonexistent')
      .send({ banned: true })

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })
})

// ─── DELETE /admin/users/:id ──────────────────────────────────────────────────

describe('DELETE /api/v1/admin/users/:id', () => {
  it('deletes a user with no bots', async () => {
    db.user.findMany.mockResolvedValue([])
    db.user.delete.mockResolvedValue({})

    const res = await request(app).delete('/api/v1/admin/users/usr_1')

    expect(res.status).toBe(204)
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'usr_1' } })
  })

  it('deletes owned bots before deleting user', async () => {
    db.user.findMany.mockResolvedValue([{ id: 'bot_1' }])
    db.user.delete.mockResolvedValue({})

    const res = await request(app).delete('/api/v1/admin/users/usr_1')

    expect(res.status).toBe(204)
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'bot_1' } })
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'usr_1' } })
  })

  it('returns 404 for missing user', async () => {
    db.user.findMany.mockResolvedValue([])
    const err = new Error('Not found')
    err.code = 'P2025'
    db.user.delete.mockRejectedValue(err)

    const res = await request(app).delete('/api/v1/admin/users/nonexistent')

    expect(res.status).toBe(404)
  })
})

// ─── GET /admin/games ─────────────────────────────────────────────────────────

describe('GET /api/v1/admin/games', () => {
  it('returns paginated game list', async () => {
    const mockGame = { id: 'g1', mode: 'PVAI', outcome: 'PLAYER1_WIN', endedAt: new Date(), player1: {}, player2: {}, winner: null }
    db.game.findMany.mockResolvedValue([mockGame])
    db.game.count.mockResolvedValue(1)

    const res = await request(app).get('/api/v1/admin/games')

    expect(res.status).toBe(200)
    expect(res.body.games).toHaveLength(1)
    expect(res.body.total).toBe(1)
  })

  it('filters by mode', async () => {
    db.game.findMany.mockResolvedValue([])
    db.game.count.mockResolvedValue(0)

    await request(app).get('/api/v1/admin/games?mode=pvp')

    expect(db.game.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ mode: 'PVP' }) })
    )
  })

  it('filters by outcome', async () => {
    db.game.findMany.mockResolvedValue([])
    db.game.count.mockResolvedValue(0)

    await request(app).get('/api/v1/admin/games?outcome=draw')

    expect(db.game.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ outcome: 'DRAW' }) })
    )
  })
})

// ─── DELETE /admin/games/:id ──────────────────────────────────────────────────

describe('DELETE /api/v1/admin/games/:id', () => {
  it('deletes a game', async () => {
    db.game.delete.mockResolvedValue({})

    const res = await request(app).delete('/api/v1/admin/games/g1')

    expect(res.status).toBe(204)
  })

  it('returns 404 for missing game', async () => {
    const err = new Error()
    err.code = 'P2025'
    db.game.delete.mockRejectedValue(err)

    const res = await request(app).delete('/api/v1/admin/games/nonexistent')

    expect(res.status).toBe(404)
  })
})

// ─── GET /admin/bots ──────────────────────────────────────────────────────────

describe('GET /api/v1/admin/bots', () => {
  it('returns bot list with owner enrichment', async () => {
    db.user.findMany
      .mockResolvedValueOnce([mockBot])       // bots query
      .mockResolvedValueOnce([{ id: 'usr_1', displayName: 'Alice', username: 'alice' }]) // owners
    db.user.count.mockResolvedValue(1)

    const res = await request(app).get('/api/v1/admin/bots')

    expect(res.status).toBe(200)
    expect(res.body.bots).toHaveLength(1)
    expect(res.body.bots[0].owner.displayName).toBe('Alice')
  })
})

// ─── PATCH /admin/bots/:id ────────────────────────────────────────────────────

describe('PATCH /api/v1/admin/bots/:id', () => {
  it('toggles botActive', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'bot_1', isBot: true })
    db.user.update.mockResolvedValue({ ...mockBot, botActive: false })

    const res = await request(app)
      .patch('/api/v1/admin/bots/bot_1')
      .send({ botActive: false })

    expect(res.status).toBe(200)
    expect(res.body.bot.botActive).toBe(false)
  })

  it('rejects empty displayName', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'bot_1', isBot: true })

    const res = await request(app)
      .patch('/api/v1/admin/bots/bot_1')
      .send({ displayName: '   ' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/empty/i)
  })

  it('rejects reserved bot names', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'bot_1', isBot: true })
    getSystemConfig.mockResolvedValue([])

    const res = await request(app)
      .patch('/api/v1/admin/bots/bot_1')
      .send({ displayName: 'Rusty' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('RESERVED_NAME')
  })

  it('rejects profane bot names', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'bot_1', isBot: true })
    getSystemConfig.mockResolvedValue(['badword'])

    const res = await request(app)
      .patch('/api/v1/admin/bots/bot_1')
      .send({ displayName: 'mybadwordbot' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('PROFANITY')
  })

  it('returns 404 for non-bot id', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'usr_1', isBot: false })

    const res = await request(app)
      .patch('/api/v1/admin/bots/usr_1')
      .send({ botActive: false })

    expect(res.status).toBe(404)
  })

  it('returns 400 when no fields provided', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'bot_1', isBot: true })

    const res = await request(app)
      .patch('/api/v1/admin/bots/bot_1')
      .send({})

    expect(res.status).toBe(400)
  })
})

// ─── DELETE /admin/bots/:id ───────────────────────────────────────────────────

describe('DELETE /api/v1/admin/bots/:id', () => {
  it('deletes bot and its games', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'bot_1', isBot: true, botModelId: null })
    db.$transaction.mockImplementation(async (fn) => fn({ game: db.game, user: db.user }))
    db.game.deleteMany.mockResolvedValue({})
    db.user.delete.mockResolvedValue({})

    const res = await request(app).delete('/api/v1/admin/bots/bot_1')

    expect(res.status).toBe(204)
  })

  it('returns 404 for non-bot id', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'usr_1', isBot: false })

    const res = await request(app).delete('/api/v1/admin/bots/usr_1')

    expect(res.status).toBe(404)
  })
})

// ─── ML model admin ───────────────────────────────────────────────────────────

describe('GET /api/v1/admin/ml/models', () => {
  it('returns model list with creator names', async () => {
    db.mLModel.findMany.mockResolvedValue([mockModel])
    db.mLModel.count.mockResolvedValue(1)
    db.user.findMany.mockResolvedValue([{ betterAuthId: 'ba_user_1', displayName: 'Alice', username: 'alice' }])

    const res = await request(app).get('/api/v1/admin/ml/models')

    expect(res.status).toBe(200)
    expect(res.body.models[0].creatorName).toBe('Alice')
    expect(res.body.total).toBe(1)
  })

  it('filters by status', async () => {
    db.mLModel.findMany.mockResolvedValue([])
    db.mLModel.count.mockResolvedValue(0)
    db.user.findMany.mockResolvedValue([])

    await request(app).get('/api/v1/admin/ml/models?status=TRAINING')

    expect(db.mLModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'TRAINING' }) })
    )
  })

  it('ignores invalid status filter', async () => {
    db.mLModel.findMany.mockResolvedValue([])
    db.mLModel.count.mockResolvedValue(0)
    db.user.findMany.mockResolvedValue([])

    await request(app).get('/api/v1/admin/ml/models?status=INVALID')

    expect(db.mLModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ status: 'INVALID' }) })
    )
  })
})

describe('PATCH /api/v1/admin/ml/models/:id/feature', () => {
  it('toggles featured from false to true', async () => {
    db.mLModel.findUnique.mockResolvedValue({ featured: false })
    db.mLModel.update.mockResolvedValue({ id: 'model_1', featured: true })

    const res = await request(app).patch('/api/v1/admin/ml/models/model_1/feature')

    expect(res.status).toBe(200)
    expect(res.body.model.featured).toBe(true)
  })

  it('returns 404 for missing model', async () => {
    db.mLModel.findUnique.mockResolvedValue(null)

    const res = await request(app).patch('/api/v1/admin/ml/models/nonexistent/feature')

    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v1/admin/ml/models/:id', () => {
  it('deletes model when no bot references it', async () => {
    db.user.findFirst.mockResolvedValue(null)
    deleteModel.mockResolvedValue()

    const res = await request(app).delete('/api/v1/admin/ml/models/model_1')

    expect(res.status).toBe(204)
    expect(deleteModel).toHaveBeenCalledWith('model_1')
  })

  it('blocks deletion when a bot references the model', async () => {
    db.user.findFirst.mockResolvedValue({ id: 'bot_1', displayName: 'MyBot' })

    const res = await request(app).delete('/api/v1/admin/ml/models/model_1')

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('BOT_REFERENCES_MODEL')
    expect(deleteModel).not.toHaveBeenCalled()
  })

  it('returns 404 when model not found', async () => {
    db.user.findFirst.mockResolvedValue(null)
    deleteModel.mockRejectedValue(new Error('Model not found'))

    const res = await request(app).delete('/api/v1/admin/ml/models/nonexistent')

    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/v1/admin/ml/models/:id/max-episodes', () => {
  it('increases maxEpisodes', async () => {
    db.mLModel.findUnique.mockResolvedValue({ id: 'model_1', maxEpisodes: 1000 })
    db.mLModel.update.mockResolvedValue({ id: 'model_1', maxEpisodes: 5000 })

    const res = await request(app)
      .patch('/api/v1/admin/ml/models/model_1/max-episodes')
      .send({ maxEpisodes: 5000 })

    expect(res.status).toBe(200)
    expect(res.body.model.maxEpisodes).toBe(5000)
  })

  it('rejects decreasing maxEpisodes', async () => {
    db.mLModel.findUnique.mockResolvedValue({ id: 'model_1', maxEpisodes: 5000 })

    const res = await request(app)
      .patch('/api/v1/admin/ml/models/model_1/max-episodes')
      .send({ maxEpisodes: 1000 })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/decrease/i)
  })

  it('rejects negative maxEpisodes', async () => {
    db.mLModel.findUnique.mockResolvedValue({ id: 'model_1', maxEpisodes: 1000 })

    const res = await request(app)
      .patch('/api/v1/admin/ml/models/model_1/max-episodes')
      .send({ maxEpisodes: -1 })

    expect(res.status).toBe(400)
  })

  it('returns 404 for missing model', async () => {
    db.mLModel.findUnique.mockResolvedValue(null)

    const res = await request(app)
      .patch('/api/v1/admin/ml/models/nonexistent/max-episodes')
      .send({ maxEpisodes: 5000 })

    expect(res.status).toBe(404)
  })
})

// ─── ML limits ────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/ml/limits', () => {
  it('returns all limit config values', async () => {
    getSystemConfig
      .mockResolvedValueOnce(100_000) // maxEpisodesPerSession
      .mockResolvedValueOnce(0)       // maxConcurrentSessions
      .mockResolvedValueOnce(10)      // maxModelsPerUser
      .mockResolvedValueOnce(100_000) // maxEpisodesPerModel
      .mockResolvedValueOnce([32])    // dqnDefaultHiddenLayers
      .mockResolvedValueOnce(3)       // dqnMaxHiddenLayers
      .mockResolvedValueOnce(256)     // dqnMaxUnitsPerLayer

    const res = await request(app).get('/api/v1/admin/ml/limits')

    expect(res.status).toBe(200)
    expect(res.body.limits.maxEpisodesPerSession).toBe(100_000)
    expect(res.body.limits.maxModelsPerUser).toBe(10)
    expect(res.body.limits.dqnDefaultHiddenLayers).toEqual([32])
  })
})

describe('PATCH /api/v1/admin/ml/limits', () => {
  it('updates maxEpisodesPerSession', async () => {
    setSystemConfig.mockResolvedValue()
    getSystemConfig
      .mockResolvedValueOnce(50_000)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(100_000)
      .mockResolvedValueOnce([32])
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(256)

    const res = await request(app)
      .patch('/api/v1/admin/ml/limits')
      .send({ maxEpisodesPerSession: 50_000 })

    expect(res.status).toBe(200)
    expect(setSystemConfig).toHaveBeenCalledWith('ml.maxEpisodesPerSession', 50_000)
  })

  it('rejects negative maxEpisodesPerSession', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ml/limits')
      .send({ maxEpisodesPerSession: -1 })

    expect(res.status).toBe(400)
  })

  it('rejects empty dqnDefaultHiddenLayers array', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ml/limits')
      .send({ dqnDefaultHiddenLayers: [] })

    expect(res.status).toBe(400)
  })

  it('rejects non-positive layer sizes', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ml/limits')
      .send({ dqnDefaultHiddenLayers: [32, 0] })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/positive integer/)
  })

  it('returns 400 when no valid fields provided', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ml/limits')
      .send({ unknownField: 123 })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/No valid fields/)
  })
})

// ─── Bot limits & AI vs AI config ────────────────────────────────────────────

describe('GET /api/v1/admin/bot-limits', () => {
  it('returns defaultBotLimit', async () => {
    getSystemConfig.mockResolvedValue(5)

    const res = await request(app).get('/api/v1/admin/bot-limits')

    expect(res.status).toBe(200)
    expect(res.body.defaultBotLimit).toBe(5)
  })
})

describe('PATCH /api/v1/admin/bot-limits', () => {
  it('updates defaultBotLimit', async () => {
    setSystemConfig.mockResolvedValue()
    getSystemConfig.mockResolvedValue(10)

    const res = await request(app)
      .patch('/api/v1/admin/bot-limits')
      .send({ defaultBotLimit: 10 })

    expect(res.status).toBe(200)
    expect(res.body.defaultBotLimit).toBe(10)
    expect(setSystemConfig).toHaveBeenCalledWith('bots.defaultBotLimit', 10)
  })

  it('rejects negative defaultBotLimit', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/bot-limits')
      .send({ defaultBotLimit: -1 })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/admin/aivai-config', () => {
  it('returns maxGames', async () => {
    getSystemConfig.mockResolvedValue(5)

    const res = await request(app).get('/api/v1/admin/aivai-config')

    expect(res.status).toBe(200)
    expect(res.body.maxGames).toBe(5)
  })
})

describe('PATCH /api/v1/admin/aivai-config', () => {
  it('updates maxGames', async () => {
    setSystemConfig.mockResolvedValue()
    getSystemConfig.mockResolvedValue(10)

    const res = await request(app)
      .patch('/api/v1/admin/aivai-config')
      .send({ maxGames: 10 })

    expect(res.status).toBe(200)
    expect(res.body.maxGames).toBe(10)
  })

  it('rejects maxGames less than 1', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/aivai-config')
      .send({ maxGames: 0 })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/positive integer/)
  })
})

// ─── Log retention ────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/logs/limit', () => {
  it('returns maxEntries', async () => {
    getSystemConfig.mockResolvedValue(10_000)

    const res = await request(app).get('/api/v1/admin/logs/limit')

    expect(res.status).toBe(200)
    expect(res.body.maxEntries).toBe(10_000)
  })
})

describe('PATCH /api/v1/admin/logs/limit', () => {
  it('updates maxEntries', async () => {
    setSystemConfig.mockResolvedValue()

    const res = await request(app)
      .patch('/api/v1/admin/logs/limit')
      .send({ maxEntries: 5000 })

    expect(res.status).toBe(200)
    expect(res.body.maxEntries).toBe(5000)
    expect(setSystemConfig).toHaveBeenCalledWith('logs.maxEntries', 5000)
  })

  it('rejects negative maxEntries', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/logs/limit')
      .send({ maxEntries: -1 })

    expect(res.status).toBe(400)
  })
})
