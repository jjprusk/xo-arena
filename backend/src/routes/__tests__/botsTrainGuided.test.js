// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Guided training endpoints — POST /api/v1/bots/:id/train-guided and
 * POST /api/v1/bots/:id/train-guided/finalize.
 *
 * Covers:
 *   - train-guided: creates Q-Learning BotSkill, kicks off mlService.startTraining,
 *     returns { sessionId, skillId, channelPrefix }; rejects non-minimax bots;
 *     reuses existing skill + running session.
 *   - finalize: swaps botModelId, fires journey step 4, validates session state.
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
    botSkill: {
      findFirst:  vi.fn(),
      findUnique: vi.fn(),
      update:     vi.fn(),
    },
    trainingSession: {
      findFirst:  vi.fn(),
      findUnique: vi.fn(),
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

vi.mock('../../services/mlService.js', () => ({
  createModel:   vi.fn(),
  startTraining: vi.fn(),
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

const botsRouter            = (await import('../bots.js')).default
const db                    = (await import('../../lib/db.js')).default
const { getSystemConfig }   = await import('../../services/skillService.js')
const { completeStep }      = await import('../../services/journeyService.js')
const { hasRole }           = await import('../../utils/roles.js')
const mlSvc                 = await import('../../services/mlService.js')

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

const novBot = {
  id:           'bot_42',
  displayName:  'Spark',
  botOwnerId:   'usr_1',
  isBot:        true,
  botModelType: 'minimax',
  botModelId:   'user:usr_1:minimax:novice',
}

beforeEach(() => {
  vi.clearAllMocks()
  hasRole.mockReturnValue(false)

  db.user.findUnique.mockImplementation(async ({ where }) => {
    if (where?.betterAuthId === 'ba_user_1') return callerUser
    if (where?.id === 'bot_42')              return novBot
    if (where?.id === 'bot_ml')              return { ...novBot, id: 'bot_ml', botModelType: 'qlearning', botModelId: 'sk_existing' }
    if (where?.id === 'bot_other')           return { ...novBot, id: 'bot_other', botOwnerId: 'usr_other' }
    return null
  })

  getSystemConfig.mockImplementation(async (_key, def) => def)
})

// ── POST /api/v1/bots/:id/train-guided ───────────────────────────────────

describe('POST /api/v1/bots/:id/train-guided', () => {
  it('creates a Q-Learning skill, calls startTraining, and returns sessionId + skillId + channelPrefix', async () => {
    db.botSkill.findFirst.mockResolvedValue(null)              // no existing skill
    mlSvc.createModel.mockResolvedValue({ id: 'sk_new' })
    db.botSkill.update.mockResolvedValue({ id: 'sk_new', botId: 'bot_42', gameId: 'xo' })
    db.trainingSession.findFirst.mockResolvedValue(null)       // no running session
    mlSvc.startTraining.mockResolvedValue({ id: 'sess_99', status: 'RUNNING' })

    const res = await request(makeApp()).post('/api/v1/bots/bot_42/train-guided')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      sessionId:     'sess_99',
      skillId:       'sk_new',
      channelPrefix: 'ml:session:sess_99:',
      reused:        false,
    })
    expect(mlSvc.createModel).toHaveBeenCalledWith(expect.objectContaining({
      name:      'Spark XO',
      algorithm: 'Q_LEARNING',
      createdBy: 'ba_user_1',
    }))
    expect(mlSvc.startTraining).toHaveBeenCalledWith('sk_new', expect.objectContaining({
      mode:       'VS_MINIMAX',
      iterations: 30000,
      config:     { difficulty: 'easy' },
    }))
  })

  it('reuses an existing Q-Learning skill rather than creating a duplicate', async () => {
    db.botSkill.findFirst.mockResolvedValue({ id: 'sk_old', botId: 'bot_42', algorithm: 'Q_LEARNING' })
    db.trainingSession.findFirst.mockResolvedValue(null)
    mlSvc.startTraining.mockResolvedValue({ id: 'sess_77', status: 'RUNNING' })

    const res = await request(makeApp()).post('/api/v1/bots/bot_42/train-guided')

    expect(res.status).toBe(200)
    expect(res.body.skillId).toBe('sk_old')
    expect(mlSvc.createModel).not.toHaveBeenCalled()
    expect(mlSvc.startTraining).toHaveBeenCalledWith('sk_old', expect.any(Object))
  })

  it('returns the in-flight session (reused=true) without queuing a second when one is already RUNNING', async () => {
    db.botSkill.findFirst.mockResolvedValue({ id: 'sk_old' })
    db.trainingSession.findFirst.mockResolvedValue({ id: 'sess_inflight', status: 'RUNNING' })

    const res = await request(makeApp()).post('/api/v1/bots/bot_42/train-guided')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      sessionId:     'sess_inflight',
      skillId:       'sk_old',
      channelPrefix: 'ml:session:sess_inflight:',
      reused:        true,
    })
    expect(mlSvc.startTraining).not.toHaveBeenCalled()
  })

  it('400 NOT_QUICK_BOT on a non-minimax bot', async () => {
    const res = await request(makeApp()).post('/api/v1/bots/bot_ml/train-guided')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('NOT_QUICK_BOT')
    expect(mlSvc.startTraining).not.toHaveBeenCalled()
  })

  it('403 when the caller is not the owner and lacks BOT_ADMIN', async () => {
    const res = await request(makeApp()).post('/api/v1/bots/bot_other/train-guided')
    expect(res.status).toBe(403)
    expect(mlSvc.startTraining).not.toHaveBeenCalled()
  })
})

// ── POST /api/v1/bots/:id/train-guided/finalize ──────────────────────────

describe('POST /api/v1/bots/:id/train-guided/finalize', () => {
  it('swaps botModelId, flips botModelType to qlearning, fires step 4, returns summary', async () => {
    db.botSkill.findUnique.mockResolvedValue({ id: 'sk_new', botId: 'bot_42' })
    db.trainingSession.findUnique.mockResolvedValue({
      id:       'sess_99',
      modelId:  'sk_new',
      status:   'COMPLETED',
      summary:  { winRate: 0.62, episodes: 1500 },
    })
    db.user.update.mockResolvedValue({})
    // loadBotAndAuthorize selects `username`; the response-shape lookup does not —
    // use that to distinguish the two findUnique calls in this handler.
    db.user.findUnique.mockImplementation(async ({ where, select }) => {
      if (where?.betterAuthId === 'ba_user_1') return callerUser
      if (where?.id === 'bot_42' && select?.username) return novBot
      if (where?.id === 'bot_42')                     return { id: 'bot_42', displayName: 'Spark', botModelId: 'sk_new', botModelType: 'qlearning' }
      return null
    })

    const res = await request(makeApp())
      .post('/api/v1/bots/bot_42/train-guided/finalize')
      .send({ sessionId: 'sess_99', skillId: 'sk_new' })

    expect(res.status).toBe(200)
    expect(res.body.bot).toEqual({ id: 'bot_42', displayName: 'Spark', botModelId: 'sk_new', botModelType: 'qlearning' })
    expect(res.body.summary).toEqual({ winRate: 0.62, episodes: 1500 })
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'bot_42' },
      data:  { botModelId: 'sk_new', botModelType: 'qlearning' },
    })
    expect(completeStep).toHaveBeenCalledWith('usr_1', 4)
  })

  it('idempotent: bot already points at skill — skips update, still fires step 4', async () => {
    db.user.findUnique.mockImplementation(async ({ where, select }) => {
      if (where?.betterAuthId === 'ba_user_1') return callerUser
      if (where?.id === 'bot_42' && select?.username) return { ...novBot, botModelId: 'sk_new', botModelType: 'qlearning' }
      if (where?.id === 'bot_42')                     return { id: 'bot_42', displayName: 'Spark', botModelId: 'sk_new', botModelType: 'qlearning' }
      return null
    })
    db.botSkill.findUnique.mockResolvedValue({ id: 'sk_new', botId: 'bot_42' })
    db.trainingSession.findUnique.mockResolvedValue({ id: 'sess_99', modelId: 'sk_new', status: 'COMPLETED', summary: {} })

    const res = await request(makeApp())
      .post('/api/v1/bots/bot_42/train-guided/finalize')
      .send({ sessionId: 'sess_99', skillId: 'sk_new' })

    expect(res.status).toBe(200)
    expect(db.user.update).not.toHaveBeenCalled()
    expect(completeStep).toHaveBeenCalledWith('usr_1', 4)
  })

  it('400 INVALID_BODY when sessionId or skillId is missing', async () => {
    const res = await request(makeApp())
      .post('/api/v1/bots/bot_42/train-guided/finalize')
      .send({ sessionId: 'sess_99' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_BODY')
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('404 SKILL_NOT_FOUND when the skill is not bound to this bot', async () => {
    db.botSkill.findUnique.mockResolvedValue({ id: 'sk_other', botId: 'bot_999' })

    const res = await request(makeApp())
      .post('/api/v1/bots/bot_42/train-guided/finalize')
      .send({ sessionId: 'sess_99', skillId: 'sk_other' })

    expect(res.status).toBe(404)
    expect(res.body.code).toBe('SKILL_NOT_FOUND')
    expect(completeStep).not.toHaveBeenCalled()
  })

  it('404 SESSION_NOT_FOUND when session does not belong to the skill', async () => {
    db.botSkill.findUnique.mockResolvedValue({ id: 'sk_new', botId: 'bot_42' })
    db.trainingSession.findUnique.mockResolvedValue({ id: 'sess_99', modelId: 'sk_other', status: 'COMPLETED' })

    const res = await request(makeApp())
      .post('/api/v1/bots/bot_42/train-guided/finalize')
      .send({ sessionId: 'sess_99', skillId: 'sk_new' })

    expect(res.status).toBe(404)
    expect(res.body.code).toBe('SESSION_NOT_FOUND')
  })

  it('409 SESSION_NOT_COMPLETE when training is still running', async () => {
    db.botSkill.findUnique.mockResolvedValue({ id: 'sk_new', botId: 'bot_42' })
    db.trainingSession.findUnique.mockResolvedValue({ id: 'sess_99', modelId: 'sk_new', status: 'RUNNING' })

    const res = await request(makeApp())
      .post('/api/v1/bots/bot_42/train-guided/finalize')
      .send({ sessionId: 'sess_99', skillId: 'sk_new' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('SESSION_NOT_COMPLETE')
    expect(db.user.update).not.toHaveBeenCalled()
  })
})
