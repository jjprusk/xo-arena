import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

let isAdminMock = vi.fn().mockResolvedValue(false)

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.auth = { userId: 'ba_user_1' }; next() },
  get isAdmin() { return isAdminMock },
}))

vi.mock('../../services/mlService.js', () => ({
  listModels:              vi.fn(),
  getSystemConfig:         vi.fn(),
  getModel:                vi.fn(),
  createModel:             vi.fn(),
  updateModel:             vi.fn(),
  deleteModel:             vi.fn(),
  resetModel:              vi.fn(),
  cloneModel:              vi.fn(),
  startTraining:           vi.fn(),
  startFrontendSession:    vi.fn(),
  cancelSession:           vi.fn(),
  getSession:              vi.fn(),
  getModelSessions:        vi.fn(),
  getSessionEpisodes:      vi.fn(),
  listCheckpoints:         vi.fn(),
  saveCheckpoint:          vi.fn(),
  restoreCheckpoint:       vi.fn(),
  getEloHistory:           vi.fn(),
  getOpeningBook:          vi.fn(),
  getPlayerProfiles:       vi.fn(),
  getPlayerProfile:        vi.fn(),
  recordHumanMove:         vi.fn(),
  updatePlayerTendencies:  vi.fn(),
  listTournaments:         vi.fn(),
  getTournament:           vi.fn(),
  startTournament:         vi.fn(),
  listBenchmarks:          vi.fn(),
  startBenchmark:          vi.fn(),
  getBenchmark:            vi.fn(),
  runVersus:               vi.fn(),
  exportModel:             vi.fn(),
  getQTable:               vi.fn(),
  explainMove:             vi.fn(),
  explainActivations:      vi.fn(),
  ensembleMove:            vi.fn(),
  startHyperparamSearch:   vi.fn(),
  importModel:             vi.fn(),
  finishTrainingFromFrontend: vi.fn(),
}))

vi.mock('../../services/ruleExtractionService.js', () => ({
  extractRulesFromModel:    vi.fn(),
  extractRulesFromEnsemble: vi.fn(),
}))

vi.mock('../../ai/ruleBased.js', () => ({
  invalidateRuleSetCache: vi.fn(),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      findFirst:  vi.fn(),
    },
    mLModel: {
      findUnique: vi.fn(),
      count:      vi.fn(),
    },
    ruleSet: {
      findMany:   vi.fn(),
      findUnique: vi.fn(),
      create:     vi.fn(),
      update:     vi.fn(),
      delete:     vi.fn(),
    },
  },
}))

// ─── Lazy imports (after mocks) ───────────────────────────────────────────────

const mlRouter = (await import('../ml.js')).default
const svc      = await import('../../services/mlService.js')
const { extractRulesFromModel, extractRulesFromEnsemble } = await import('../../services/ruleExtractionService.js')
const { invalidateRuleSetCache } = await import('../../ai/ruleBased.js')
const db = (await import('../../lib/db.js')).default

// ─── App setup ────────────────────────────────────────────────────────────────

const app = express()
app.use(express.json())
app.use('/api/v1/ml', mlRouter)

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockModel = {
  id:        'model_1',
  name:      'Test Model',
  createdBy: 'ba_user_1',
  algorithm: 'Q_LEARNING',
  status:    'IDLE',
}

const otherModel = { ...mockModel, createdBy: 'other_user' }

// ─── Reset mocks before each test ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  isAdminMock = vi.fn().mockResolvedValue(false)
  // Re-wire the getter to use the fresh mock
  vi.mocked(svc.getSystemConfig).mockResolvedValue(10)
  vi.mocked(db.user.findUnique).mockResolvedValue({ mlModelLimit: null })
  vi.mocked(db.mLModel.count).mockResolvedValue(0)
  vi.mocked(db.user.findFirst).mockResolvedValue(null)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

// ── GET /models ───────────────────────────────────────────────────────────────

describe('GET /models', () => {
  it('returns the model list from svc.listModels', async () => {
    vi.mocked(svc.listModels).mockResolvedValue([mockModel])

    const res = await request(app).get('/api/v1/ml/models')
    expect(res.status).toBe(200)
    expect(res.body.models).toHaveLength(1)
    expect(res.body.models[0].id).toBe('model_1')
  })
})

// ── GET /network-config ───────────────────────────────────────────────────────

describe('GET /network-config', () => {
  it('returns DQN config from three getSystemConfig calls', async () => {
    vi.mocked(svc.getSystemConfig)
      .mockResolvedValueOnce([32])
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(256)

    const res = await request(app).get('/api/v1/ml/network-config')
    expect(res.status).toBe(200)
    expect(res.body.dqn.defaultHiddenLayers).toEqual([32])
    expect(res.body.dqn.maxHiddenLayers).toBe(3)
    expect(res.body.dqn.maxUnitsPerLayer).toBe(256)
  })
})

// ── POST /models ──────────────────────────────────────────────────────────────

describe('POST /models', () => {
  it('400 when name is missing', async () => {
    const res = await request(app).post('/api/v1/ml/models').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/name is required/)
  })

  it('400 when name is empty string', async () => {
    const res = await request(app).post('/api/v1/ml/models').send({ name: '   ' })
    expect(res.status).toBe(400)
  })

  it('403 when model limit reached', async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ mlModelLimit: null })
    vi.mocked(db.mLModel.count).mockResolvedValue(10)
    vi.mocked(svc.getSystemConfig).mockResolvedValue(10)

    const res = await request(app).post('/api/v1/ml/models').send({ name: 'New' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/limit reached/)
  })

  it('201 on success', async () => {
    vi.mocked(db.mLModel.count).mockResolvedValue(0)
    vi.mocked(svc.createModel).mockResolvedValue(mockModel)

    const res = await request(app).post('/api/v1/ml/models').send({ name: 'New Model' })
    expect(res.status).toBe(201)
    expect(res.body.model.id).toBe('model_1')
  })
})

// ── GET /models/:id ───────────────────────────────────────────────────────────

describe('GET /models/:id', () => {
  it('404 when model not found', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(null)

    const res = await request(app).get('/api/v1/ml/models/missing_id')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })

  it('200 with model', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(mockModel)

    const res = await request(app).get('/api/v1/ml/models/model_1')
    expect(res.status).toBe(200)
    expect(res.body.model.id).toBe('model_1')
  })
})

// ── PATCH /models/:id ─────────────────────────────────────────────────────────

describe('PATCH /models/:id', () => {
  it('404 when model not found', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(null)

    const res = await request(app).patch('/api/v1/ml/models/model_1').send({ name: 'Updated' })
    expect(res.status).toBe(404)
  })

  it('403 when owned by a different user and isAdmin=false', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(otherModel)
    isAdminMock = vi.fn().mockResolvedValue(false)

    const res = await request(app).patch('/api/v1/ml/models/model_1').send({ name: 'Updated' })
    expect(res.status).toBe(403)
  })

  it('200 when owner matches req.auth.userId', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(mockModel)
    vi.mocked(svc.updateModel).mockResolvedValue({ ...mockModel, name: 'Updated' })

    const res = await request(app).patch('/api/v1/ml/models/model_1').send({ name: 'Updated' })
    expect(res.status).toBe(200)
    expect(res.body.model.name).toBe('Updated')
  })
})

// ── DELETE /models/:id ────────────────────────────────────────────────────────

describe('DELETE /models/:id', () => {
  it('404 when not found', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(null)

    const res = await request(app).delete('/api/v1/ml/models/model_1')
    expect(res.status).toBe(404)
  })

  it('403 when not owner', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(otherModel)
    isAdminMock = vi.fn().mockResolvedValue(false)

    const res = await request(app).delete('/api/v1/ml/models/model_1')
    expect(res.status).toBe(403)
  })

  it('204 on success', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(mockModel)
    vi.mocked(svc.deleteModel).mockResolvedValue(undefined)

    const res = await request(app).delete('/api/v1/ml/models/model_1')
    expect(res.status).toBe(204)
  })
})

// ── POST /models/:id/reset ────────────────────────────────────────────────────

describe('POST /models/:id/reset', () => {
  it('404 when not found', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(null)

    const res = await request(app).post('/api/v1/ml/models/model_1/reset')
    expect(res.status).toBe(404)
  })

  it('200 with reset model', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(mockModel)
    vi.mocked(svc.resetModel).mockResolvedValue({ ...mockModel, status: 'IDLE' })

    const res = await request(app).post('/api/v1/ml/models/model_1/reset')
    expect(res.status).toBe(200)
    expect(res.body.model).toBeDefined()
  })
})

// ── POST /models/:id/clone ────────────────────────────────────────────────────

describe('POST /models/:id/clone', () => {
  it('403 when limit reached', async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ mlModelLimit: null })
    vi.mocked(db.mLModel.count).mockResolvedValue(10)
    vi.mocked(svc.getSystemConfig).mockResolvedValue(10)

    const res = await request(app).post('/api/v1/ml/models/model_1/clone').send({ name: 'Clone' })
    expect(res.status).toBe(403)
  })

  it('201 on success', async () => {
    vi.mocked(db.mLModel.count).mockResolvedValue(0)
    vi.mocked(svc.cloneModel).mockResolvedValue({ ...mockModel, id: 'model_clone', name: 'Clone' })

    const res = await request(app).post('/api/v1/ml/models/model_1/clone').send({ name: 'Clone' })
    expect(res.status).toBe(201)
    expect(res.body.model.id).toBe('model_clone')
  })
})

// ── POST /models/:id/train ────────────────────────────────────────────────────

describe('POST /models/:id/train', () => {
  it('404 when model not found (assertModelOwner)', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(null)

    const res = await request(app).post('/api/v1/ml/models/model_1/train')
      .send({ mode: 'SELF_PLAY', iterations: 100 })
    expect(res.status).toBe(404)
  })

  it('403 when not owner', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(otherModel)
    isAdminMock = vi.fn().mockResolvedValue(false)

    const res = await request(app).post('/api/v1/ml/models/model_1/train')
      .send({ mode: 'SELF_PLAY', iterations: 100 })
    expect(res.status).toBe(403)
  })

  it('409 BOT_IN_TOURNAMENT when linked bot is in a tournament', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(mockModel)
    vi.mocked(db.user.findFirst).mockResolvedValue({ displayName: 'TourneyBot' })

    const res = await request(app).post('/api/v1/ml/models/model_1/train')
      .send({ mode: 'SELF_PLAY', iterations: 100 })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('BOT_IN_TOURNAMENT')
  })

  it('400 for invalid mode', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(mockModel)

    const res = await request(app).post('/api/v1/ml/models/model_1/train')
      .send({ mode: 'INVALID_MODE', iterations: 100 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/mode must be one of/)
  })

  it('400 for iterations = 0', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(mockModel)

    const res = await request(app).post('/api/v1/ml/models/model_1/train')
      .send({ mode: 'SELF_PLAY', iterations: 0 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/iterations/)
  })

  it('400 for iterations > 100000', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(mockModel)

    const res = await request(app).post('/api/v1/ml/models/model_1/train')
      .send({ mode: 'SELF_PLAY', iterations: 100001 })
    expect(res.status).toBe(400)
  })

  it('201 on success (backend session)', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(mockModel)
    vi.mocked(svc.startTraining).mockResolvedValue({ id: 'sess_1', status: 'RUNNING' })

    const res = await request(app).post('/api/v1/ml/models/model_1/train')
      .send({ mode: 'SELF_PLAY', iterations: 500 })
    expect(res.status).toBe(201)
    expect(res.body.session.id).toBe('sess_1')
  })

  it('201 on success with frontend=true (frontend session)', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(mockModel)
    vi.mocked(svc.startFrontendSession).mockResolvedValue({ sessionId: 'sess_fe', weights: {} })

    const res = await request(app).post('/api/v1/ml/models/model_1/train')
      .send({ mode: 'SELF_PLAY', iterations: 200, frontend: true })
    expect(res.status).toBe(201)
    expect(res.body.sessionId).toBe('sess_fe')
  })

  it('409 when already training', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(mockModel)
    vi.mocked(svc.startTraining).mockRejectedValue(new Error('Model is already training'))

    const res = await request(app).post('/api/v1/ml/models/model_1/train')
      .send({ mode: 'SELF_PLAY', iterations: 100 })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already training/)
  })
})

// ── GET /models/:id/sessions ──────────────────────────────────────────────────

describe('GET /models/:id/sessions', () => {
  it('returns JSON sessions', async () => {
    vi.mocked(svc.getModelSessions).mockResolvedValue([{ id: 'sess_1', mode: 'SELF_PLAY', status: 'DONE' }])

    const res = await request(app).get('/api/v1/ml/models/model_1/sessions')
    expect(res.status).toBe(200)
    expect(res.body.sessions).toHaveLength(1)
  })

  it('returns CSV when ?format=csv', async () => {
    vi.mocked(svc.getModelSessions).mockResolvedValue([
      { id: 'sess_1', mode: 'SELF_PLAY', iterations: 100, status: 'DONE', startedAt: null, completedAt: null },
    ])

    const res = await request(app).get('/api/v1/ml/models/model_1/sessions?format=csv')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.text).toContain('id,mode,iterations,status')
    expect(res.text).toContain('sess_1')
  })
})

// ── GET /sessions/:id ─────────────────────────────────────────────────────────

describe('GET /sessions/:id', () => {
  it('404 when session not found', async () => {
    vi.mocked(svc.getSession).mockResolvedValue(null)

    const res = await request(app).get('/api/v1/ml/sessions/sess_missing')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })

  it('200 with session', async () => {
    vi.mocked(svc.getSession).mockResolvedValue({ id: 'sess_1', status: 'DONE' })

    const res = await request(app).get('/api/v1/ml/sessions/sess_1')
    expect(res.status).toBe(200)
    expect(res.body.session.id).toBe('sess_1')
  })
})

// ── POST /sessions/:id/cancel ─────────────────────────────────────────────────

describe('POST /sessions/:id/cancel', () => {
  it('404 when session not found', async () => {
    vi.mocked(svc.getSession).mockResolvedValue(null)

    const res = await request(app).post('/api/v1/ml/sessions/sess_missing/cancel')
    expect(res.status).toBe(404)
  })

  it('204 on success', async () => {
    vi.mocked(svc.getSession).mockResolvedValue({ id: 'sess_1', modelId: 'model_1' })
    vi.mocked(svc.getModel).mockResolvedValue(mockModel)
    vi.mocked(svc.cancelSession).mockResolvedValue(undefined)

    const res = await request(app).post('/api/v1/ml/sessions/sess_1/cancel')
    expect(res.status).toBe(204)
  })
})

// ── Checkpoints ───────────────────────────────────────────────────────────────

describe('GET /models/:id/checkpoints', () => {
  it('returns checkpoint list', async () => {
    vi.mocked(svc.listCheckpoints).mockResolvedValue([{ id: 'cp_1' }])

    const res = await request(app).get('/api/v1/ml/models/model_1/checkpoints')
    expect(res.status).toBe(200)
    expect(res.body.checkpoints).toHaveLength(1)
  })
})

describe('POST /models/:id/checkpoint', () => {
  it('201 on success', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(mockModel)
    vi.mocked(svc.saveCheckpoint).mockResolvedValue({ id: 'cp_1' })

    const res = await request(app).post('/api/v1/ml/models/model_1/checkpoint')
    expect(res.status).toBe(201)
    expect(res.body.checkpoint.id).toBe('cp_1')
  })
})

describe('POST /models/:id/checkpoints/:cpId/restore', () => {
  it('200 with restored model', async () => {
    vi.mocked(svc.getModel).mockResolvedValue(mockModel)
    vi.mocked(svc.restoreCheckpoint).mockResolvedValue({ ...mockModel, status: 'IDLE' })

    const res = await request(app).post('/api/v1/ml/models/model_1/checkpoints/cp_1/restore')
    expect(res.status).toBe(200)
    expect(res.body.model).toBeDefined()
  })
})

// ── GET /models/:id/elo-history ───────────────────────────────────────────────

describe('GET /models/:id/elo-history', () => {
  it('returns ELO history', async () => {
    vi.mocked(svc.getEloHistory).mockResolvedValue([{ elo: 1200, recordedAt: '2026-01-01' }])

    const res = await request(app).get('/api/v1/ml/models/model_1/elo-history')
    expect(res.status).toBe(200)
    expect(res.body.history).toHaveLength(1)
  })
})

// ── POST /models/ensemble ─────────────────────────────────────────────────────

describe('POST /models/ensemble', () => {
  it('400 when modelIds missing', async () => {
    const res = await request(app).post('/api/v1/ml/models/ensemble')
      .send({ board: Array(9).fill(null) })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/modelIds/)
  })

  it('400 when modelIds empty array', async () => {
    const res = await request(app).post('/api/v1/ml/models/ensemble')
      .send({ modelIds: [], board: Array(9).fill(null) })
    expect(res.status).toBe(400)
  })

  it('400 when board is wrong size', async () => {
    const res = await request(app).post('/api/v1/ml/models/ensemble')
      .send({ modelIds: ['model_1'], board: [1, 2, 3] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/board must be a 9-element array/)
  })

  it('400 for invalid method', async () => {
    const res = await request(app).post('/api/v1/ml/models/ensemble')
      .send({ modelIds: ['model_1'], board: Array(9).fill(null), method: 'random' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/method must be majority or weighted/)
  })

  it('200 on success', async () => {
    vi.mocked(svc.ensembleMove).mockResolvedValue({ move: 4, votes: {} })

    const res = await request(app).post('/api/v1/ml/models/ensemble')
      .send({ modelIds: ['model_1', 'model_2'], board: Array(9).fill(null), method: 'majority' })
    expect(res.status).toBe(200)
    expect(res.body.move).toBe(4)
  })
})

// ── POST /models/:id/explain ──────────────────────────────────────────────────

describe('POST /models/:id/explain', () => {
  it('400 when board is wrong length', async () => {
    const res = await request(app).post('/api/v1/ml/models/model_1/explain')
      .send({ board: [1, 2, 3] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/9-element/)
  })

  it('200 on success', async () => {
    vi.mocked(svc.explainMove).mockResolvedValue({ move: 0, qValues: [] })

    const res = await request(app).post('/api/v1/ml/models/model_1/explain')
      .send({ board: Array(9).fill(null) })
    expect(res.status).toBe(200)
    expect(res.body.move).toBe(0)
  })
})

// ── GET /rulesets ─────────────────────────────────────────────────────────────

describe('GET /rulesets', () => {
  it('returns list of rule sets', async () => {
    vi.mocked(db.ruleSet.findMany).mockResolvedValue([{ id: 'rs_1', name: 'My Rules' }])

    const res = await request(app).get('/api/v1/ml/rulesets')
    expect(res.status).toBe(200)
    expect(res.body.ruleSets).toHaveLength(1)
  })
})

// ── POST /rulesets ────────────────────────────────────────────────────────────

describe('POST /rulesets', () => {
  it('400 when name is missing', async () => {
    const res = await request(app).post('/api/v1/ml/rulesets').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/name is required/)
  })

  it('201 with no sourceModels (empty rules)', async () => {
    vi.mocked(db.ruleSet.create).mockResolvedValue({ id: 'rs_1', name: 'Empty', rules: [] })

    const res = await request(app).post('/api/v1/ml/rulesets').send({ name: 'Empty' })
    expect(res.status).toBe(201)
    expect(res.body.ruleSet.id).toBe('rs_1')
    expect(extractRulesFromModel).not.toHaveBeenCalled()
  })

  it('201 with one sourceModel — calls extractRulesFromModel', async () => {
    vi.mocked(extractRulesFromModel).mockResolvedValue({ rules: [{ condition: 'test' }] })
    vi.mocked(db.ruleSet.create).mockResolvedValue({ id: 'rs_2', name: 'Single', rules: [{ condition: 'test' }] })

    const res = await request(app).post('/api/v1/ml/rulesets')
      .send({ name: 'Single', sourceModels: [{ modelId: 'model_1' }] })
    expect(res.status).toBe(201)
    expect(extractRulesFromModel).toHaveBeenCalledWith('model_1')
  })

  it('201 with multiple sourceModels — calls extractRulesFromEnsemble', async () => {
    vi.mocked(extractRulesFromEnsemble).mockResolvedValue([{ condition: 'ensemble' }])
    vi.mocked(db.ruleSet.create).mockResolvedValue({ id: 'rs_3', name: 'Ensemble', rules: [] })

    const sources = [{ modelId: 'model_1' }, { modelId: 'model_2' }]
    const res = await request(app).post('/api/v1/ml/rulesets')
      .send({ name: 'Ensemble', sourceModels: sources })
    expect(res.status).toBe(201)
    expect(extractRulesFromEnsemble).toHaveBeenCalledWith(sources)
  })
})

// ── GET /rulesets/:id ─────────────────────────────────────────────────────────

describe('GET /rulesets/:id', () => {
  it('404 when not found', async () => {
    vi.mocked(db.ruleSet.findUnique).mockResolvedValue(null)

    const res = await request(app).get('/api/v1/ml/rulesets/rs_missing')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })

  it('200 with ruleSet', async () => {
    vi.mocked(db.ruleSet.findUnique).mockResolvedValue({ id: 'rs_1', name: 'My Rules', rules: [] })

    const res = await request(app).get('/api/v1/ml/rulesets/rs_1')
    expect(res.status).toBe(200)
    expect(res.body.ruleSet.id).toBe('rs_1')
  })
})

// ── PATCH /rulesets/:id ───────────────────────────────────────────────────────

describe('PATCH /rulesets/:id', () => {
  it('200, calls invalidateRuleSetCache', async () => {
    vi.mocked(db.ruleSet.update).mockResolvedValue({ id: 'rs_1', name: 'Updated' })

    const res = await request(app).patch('/api/v1/ml/rulesets/rs_1').send({ name: 'Updated' })
    expect(res.status).toBe(200)
    expect(invalidateRuleSetCache).toHaveBeenCalledWith('rs_1')
  })
})

// ── DELETE /rulesets/:id ──────────────────────────────────────────────────────

describe('DELETE /rulesets/:id', () => {
  it('204, calls invalidateRuleSetCache', async () => {
    vi.mocked(db.ruleSet.delete).mockResolvedValue(undefined)

    const res = await request(app).delete('/api/v1/ml/rulesets/rs_1')
    expect(res.status).toBe(204)
    expect(invalidateRuleSetCache).toHaveBeenCalledWith('rs_1')
  })
})

// ── POST /rulesets/:id/extract ────────────────────────────────────────────────

describe('POST /rulesets/:id/extract', () => {
  it('404 when ruleset not found', async () => {
    vi.mocked(db.ruleSet.findUnique).mockResolvedValue(null)

    const res = await request(app).post('/api/v1/ml/rulesets/rs_missing/extract')
    expect(res.status).toBe(404)
  })

  it('400 when no source models', async () => {
    vi.mocked(db.ruleSet.findUnique).mockResolvedValue({ id: 'rs_1', sourceModels: [] })

    const res = await request(app).post('/api/v1/ml/rulesets/rs_1/extract').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/No source models/)
  })

  it('200 on success with single model', async () => {
    vi.mocked(db.ruleSet.findUnique).mockResolvedValue({
      id: 'rs_1',
      sourceModels: [{ modelId: 'model_1' }],
    })
    vi.mocked(extractRulesFromModel).mockResolvedValue({ rules: [{ condition: 'test' }] })
    vi.mocked(db.ruleSet.update).mockResolvedValue({ id: 'rs_1', rules: [{ condition: 'test' }] })

    const res = await request(app).post('/api/v1/ml/rulesets/rs_1/extract')
    expect(res.status).toBe(200)
    expect(res.body.ruleSet.id).toBe('rs_1')
    expect(invalidateRuleSetCache).toHaveBeenCalledWith('rs_1')
  })
})

// ── POST /tournament ──────────────────────────────────────────────────────────

describe('POST /tournament', () => {
  it('400 when modelIds < 2', async () => {
    vi.mocked(svc.startTournament).mockRejectedValue(new Error('Need at least 2 models'))

    const res = await request(app).post('/api/v1/ml/tournament').send({ modelIds: ['model_1'] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/at least 2/)
  })

  it('201 on success', async () => {
    vi.mocked(svc.startTournament).mockResolvedValue({ id: 'tourn_1', status: 'RUNNING' })

    const res = await request(app).post('/api/v1/ml/tournament')
      .send({ modelIds: ['model_1', 'model_2'], gamesPerPair: 10 })
    expect(res.status).toBe(201)
    expect(res.body.tournament.id).toBe('tourn_1')
  })
})
