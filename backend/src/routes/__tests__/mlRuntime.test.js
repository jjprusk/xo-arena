// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.10 — GET /ml/runtime contract.
 *
 * Thin endpoint over resolveTrainingRuntime. We mock the resolver so the
 * test asserts only the request-shape + response-shape + cache header
 * behavior; the routing logic is unit-tested in trainingRuntime.test.js.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.auth = { userId: 'ba_user_1' }; next() },
  isAdmin:     () => false,
}))

vi.mock('../../services/mlService.js', () => ({
  getSystemConfig: vi.fn(),
  // Other named exports the router imports must exist so module-load doesn't
  // throw — leave them as no-op stubs.
  listModels:           vi.fn(), getModel: vi.fn(),
  createModel:          vi.fn(), updateModel: vi.fn(), deleteModel: vi.fn(),
  resetModel:           vi.fn(), cloneModel: vi.fn(), startTraining: vi.fn(),
  startFrontendSession: vi.fn(), cancelSession: vi.fn(), getSession: vi.fn(),
  getModelSessions:     vi.fn(), getSessionEpisodes: vi.fn(),
  listCheckpoints:      vi.fn(), saveCheckpoint: vi.fn(), restoreCheckpoint: vi.fn(),
  getEloHistory:        vi.fn(), getOpeningBook: vi.fn(),
  getPlayerProfiles:    vi.fn(), getPlayerProfile: vi.fn(),
  recordHumanMove:      vi.fn(), updatePlayerTendencies: vi.fn(),
  listTournaments:      vi.fn(), getTournament: vi.fn(), startTournament: vi.fn(),
  listBenchmarks:       vi.fn(), startBenchmark: vi.fn(), getBenchmark: vi.fn(),
  runVersus:            vi.fn(), exportModel: vi.fn(), getQTable: vi.fn(),
  explainMove:          vi.fn(), explainActivations: vi.fn(),
  ensembleMove:         vi.fn(), startHyperparamSearch: vi.fn(),
  importModel:          vi.fn(), finishTrainingFromFrontend: vi.fn(),
}))

vi.mock('../../services/ruleExtractionService.js', () => ({
  extractRulesFromModel:    vi.fn(),
  extractRulesFromEnsemble: vi.fn(),
}))

vi.mock('../../ai/ruleBased.js', () => ({
  invalidateRuleSetCache: vi.fn(),
}))

vi.mock('../../lib/db.js', () => ({
  default: { user: {}, botSkill: {}, trainingSession: {} },
}))

const { mockResolve } = vi.hoisted(() => ({ mockResolve: vi.fn() }))
vi.mock('../../services/trainingRuntime.js', () => ({
  resolveTrainingRuntime: mockResolve,
}))

const mlRouter = (await import('../ml.js')).default

const app = express()
app.use(express.json())
app.use('/api/v1/ml', mlRouter)

beforeEach(() => vi.clearAllMocks())

describe('GET /api/v1/ml/runtime', () => {
  it('returns the resolved runtime for the (gameId, algorithm) pair', async () => {
    mockResolve.mockResolvedValue('frontend')
    const res = await request(app).get('/api/v1/ml/runtime?gameId=tic-tac-toe&algorithm=qlearning')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ gameId: 'tic-tac-toe', algorithm: 'qlearning', runtime: 'frontend' })
    expect(res.headers['cache-control']).toBe('no-store')
    expect(mockResolve).toHaveBeenCalledWith('tic-tac-toe', 'qlearning', expect.objectContaining({
      getConfig: expect.any(Function),
    }))
  })

  it('400s when gameId is missing', async () => {
    const res = await request(app).get('/api/v1/ml/runtime?algorithm=qlearning')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/gameId and algorithm/)
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('400s when algorithm is missing', async () => {
    const res = await request(app).get('/api/v1/ml/runtime?gameId=tic-tac-toe')
    expect(res.status).toBe(400)
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('passes through worker / backend-in-process verdicts unchanged', async () => {
    for (const runtime of ['worker', 'backend-in-process']) {
      mockResolve.mockResolvedValueOnce(runtime)
      const res = await request(app).get('/api/v1/ml/runtime?gameId=connect-four&algorithm=alphazero')
      expect(res.status).toBe(200)
      expect(res.body.runtime).toBe(runtime)
    }
  })
})
