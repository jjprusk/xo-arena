// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Quick Bot wizard endpoints (§5.3) — POST /api/v1/bots/quick and
 * POST /api/v1/bots/:id/train-quick.
 *
 * Covers:
 *   - Quick create: name validation, persona accepted, tier from SystemConfig,
 *     journey step 3 fired, bot-limit enforcement, name collisions
 *   - Train-quick: bumps botModelId tier, fires step 4, idempotent on already
 *     trained, rejects non-minimax bots
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.auth = { userId: 'ba_user_1' }
    next()
  },
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      findMany:   vi.fn(),
      count:      vi.fn().mockResolvedValue(0),
      update:     vi.fn(),
    },
  },
}))

vi.mock('../../services/userService.js', () => ({
  createBot: vi.fn(),
  listBots:  vi.fn().mockResolvedValue([]),
}))

vi.mock('../../services/skillService.js', () => ({
  getSystemConfig: vi.fn(),
}))

vi.mock('../../services/creditService.js', () => ({
  getTierLimit: vi.fn().mockResolvedValue(5),
}))

vi.mock('../../services/journeyService.js', () => ({
  completeStep: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../utils/cache.js', () => ({
  default: {
    get:        vi.fn(),
    set:        vi.fn(),
    invalidate: vi.fn(),
  },
}))

vi.mock('../../utils/roles.js', () => ({
  hasRole: vi.fn().mockReturnValue(false),
}))

const botsRouter = (await import('../bots.js')).default
const db = (await import('../../lib/db.js')).default
const { createBot } = await import('../../services/userService.js')
const { getSystemConfig } = await import('../../services/skillService.js')
const { getTierLimit } = await import('../../services/creditService.js')
const { completeStep } = await import('../../services/journeyService.js')
const { hasRole } = await import('../../utils/roles.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/bots', botsRouter)
  return app
}

const callerUser = {
  id: 'usr_1',
  betterAuthId: 'ba_user_1',
  userRoles: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  hasRole.mockReturnValue(false)
  db.user.findUnique.mockResolvedValue(callerUser)
  db.user.count.mockResolvedValue(0)
  getTierLimit.mockResolvedValue(5)
  getSystemConfig.mockImplementation(async (key, def) => {
    if (key === 'guide.quickBot.defaultTier')        return 'novice'
    if (key === 'guide.quickBot.firstTrainingTier')  return 'intermediate'
    return def
  })
})

// ── POST /api/v1/bots/quick ──────────────────────────────────────────────

describe('POST /api/v1/bots/quick', () => {
  it('creates a minimax-novice bot using guide.quickBot.defaultTier and fires journey step 3', async () => {
    createBot.mockResolvedValue({
      id: 'bot_42',
      displayName: 'Spark',
      botModelType: 'minimax',
      botModelId: 'user:usr_1:minimax:novice',
    })

    const res = await request(makeApp())
      .post('/api/v1/bots/quick')
      .send({ name: 'Spark', persona: 'aggressive' })

    expect(res.status).toBe(201)
    expect(res.body.bot.id).toBe('bot_42')
    expect(createBot).toHaveBeenCalledWith('usr_1', expect.objectContaining({
      name:       'Spark',
      algorithm:  'minimax',
      difficulty: 'novice',
      ownerBaId:  'ba_user_1',
    }))
    expect(getSystemConfig).toHaveBeenCalledWith('guide.quickBot.defaultTier', 'novice')
    expect(completeStep).toHaveBeenCalledWith('usr_1', 3)
  })

  it('400 INVALID_NAME on missing name', async () => {
    const res = await request(makeApp()).post('/api/v1/bots/quick').send({})
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_NAME')
    expect(createBot).not.toHaveBeenCalled()
  })

  it('400 INVALID_PERSONA when persona is the wrong type', async () => {
    const res = await request(makeApp()).post('/api/v1/bots/quick').send({ name: 'OK', persona: 42 })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_PERSONA')
  })

  it('409 BOT_LIMIT_REACHED when the user is at the tier cap', async () => {
    db.user.count.mockResolvedValue(5)
    getTierLimit.mockResolvedValue(5)
    const res = await request(makeApp()).post('/api/v1/bots/quick').send({ name: 'Spark' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('BOT_LIMIT_REACHED')
    expect(createBot).not.toHaveBeenCalled()
  })

  it('skips the limit check for BOT_ADMIN role', async () => {
    hasRole.mockReturnValue(true)
    db.user.count.mockResolvedValue(99)
    createBot.mockResolvedValue({ id: 'bot_admin', displayName: 'Whatever' })
    const res = await request(makeApp()).post('/api/v1/bots/quick').send({ name: 'Whatever' })
    expect(res.status).toBe(201)
    expect(createBot).toHaveBeenCalled()
  })

  it('translates createBot errors to the right status code (NAME_TAKEN → 409)', async () => {
    createBot.mockRejectedValue(Object.assign(new Error('"Spark" is already taken'), { code: 'NAME_TAKEN' }))
    const res = await request(makeApp()).post('/api/v1/bots/quick').send({ name: 'Spark' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('NAME_TAKEN')
  })
})

// ── POST /api/v1/bots/:id/train-quick ────────────────────────────────────

describe('POST /api/v1/bots/:id/train-quick', () => {
  const novBot = {
    id:           'bot_42',
    botOwnerId:   'usr_1',
    isBot:        true,
    botModelType: 'minimax',
    botModelId:   'user:usr_1:minimax:novice',
  }

  beforeEach(() => {
    // loadBotAndAuthorize first looks up the caller by baId, then the bot.
    db.user.findUnique.mockImplementation(async ({ where }) => {
      if (where?.betterAuthId === 'ba_user_1') return callerUser
      if (where?.id === 'bot_42')             return novBot
      if (where?.id === 'bot_other')          return { ...novBot, id: 'bot_other', botOwnerId: 'usr_other' }
      if (where?.id === 'bot_ml')             return { ...novBot, id: 'bot_ml', botModelType: 'ml', botModelId: 'sk_uuid' }
      if (where?.id === 'bot_already')        return { ...novBot, id: 'bot_already', botModelId: 'user:usr_1:minimax:intermediate' }
      return null
    })
  })

  it('bumps the botModelId from novice to intermediate and fires journey step 4', async () => {
    db.user.update.mockResolvedValue({
      ...novBot,
      botModelId: 'user:usr_1:minimax:intermediate',
    })

    const res = await request(makeApp()).post('/api/v1/bots/bot_42/train-quick')

    expect(res.status).toBe(200)
    expect(res.body.alreadyTrained).toBe(false)
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'bot_42' },
      data:  { botModelId: 'user:usr_1:minimax:intermediate' },
    })
    expect(getSystemConfig).toHaveBeenCalledWith('guide.quickBot.firstTrainingTier', 'intermediate')
    expect(completeStep).toHaveBeenCalledWith('usr_1', 4)
  })

  it('idempotent on already-trained bot: 200 alreadyTrained=true, still fires step 4', async () => {
    const res = await request(makeApp()).post('/api/v1/bots/bot_already/train-quick')
    expect(res.status).toBe(200)
    expect(res.body.alreadyTrained).toBe(true)
    expect(db.user.update).not.toHaveBeenCalled()
    expect(completeStep).toHaveBeenCalledWith('usr_1', 4)
  })

  it('400 NOT_QUICK_BOT on a non-minimax (ML) bot', async () => {
    const res = await request(makeApp()).post('/api/v1/bots/bot_ml/train-quick')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('NOT_QUICK_BOT')
    expect(db.user.update).not.toHaveBeenCalled()
    expect(completeStep).not.toHaveBeenCalled()
  })

  it('403 when the caller is not the owner and lacks BOT_ADMIN', async () => {
    const res = await request(makeApp()).post('/api/v1/bots/bot_other/train-quick')
    expect(res.status).toBe(403)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('404 when the bot does not exist', async () => {
    const res = await request(makeApp()).post('/api/v1/bots/bot_missing/train-quick')
    expect(res.status).toBe(404)
  })
})
