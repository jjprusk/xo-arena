// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.8 — GET /api/v1/ml/presets contract.
 *
 * Endpoint just delegates to listPresetsFor(); these tests assert on
 * the request-shape (query param validation + 400s) and the response
 * pass-through. Preset-table content is unit-tested in
 * config/trainingPresets.test.js.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.auth = { userId: 'ba_user_1' }; next() },
  isAdmin:     () => false,
}))

vi.mock('../../services/mlService.js', () => ({
  // Required no-op surface so ml.js module-load doesn't throw.
  getSystemConfig: vi.fn(), listModels: vi.fn(), getModel: vi.fn(),
  createModel: vi.fn(), updateModel: vi.fn(), deleteModel: vi.fn(),
  resetModel: vi.fn(), cloneModel: vi.fn(), startTraining: vi.fn(),
  startFrontendSession: vi.fn(), cancelSession: vi.fn(), getSession: vi.fn(),
  getModelSessions: vi.fn(), getSessionEpisodes: vi.fn(),
  listCheckpoints: vi.fn(), saveCheckpoint: vi.fn(), restoreCheckpoint: vi.fn(),
  getEloHistory: vi.fn(), getOpeningBook: vi.fn(),
  getPlayerProfiles: vi.fn(), getPlayerProfile: vi.fn(),
  recordHumanMove: vi.fn(), updatePlayerTendencies: vi.fn(),
  listTournaments: vi.fn(), getTournament: vi.fn(), startTournament: vi.fn(),
  listBenchmarks: vi.fn(), startBenchmark: vi.fn(), getBenchmark: vi.fn(),
  runVersus: vi.fn(), exportModel: vi.fn(), getQTable: vi.fn(),
  explainMove: vi.fn(), explainActivations: vi.fn(),
  ensembleMove: vi.fn(), startHyperparamSearch: vi.fn(),
  importModel: vi.fn(), finishTrainingFromFrontend: vi.fn(),
}))

vi.mock('../../services/ruleExtractionService.js', () => ({
  extractRulesFromModel: vi.fn(), extractRulesFromEnsemble: vi.fn(),
}))

vi.mock('../../ai/ruleBased.js', () => ({ invalidateRuleSetCache: vi.fn() }))

vi.mock('../../lib/db.js', () => ({
  default: { user: {}, botSkill: {}, trainingSession: {}, trainingMetric: {} },
}))

vi.mock('../../services/trainingRuntime.js', () => ({
  resolveTrainingRuntime: vi.fn(),
}))

const mlRouter = (await import('../ml.js')).default

const app = express()
app.use(express.json())
app.use('/api/v1/ml', mlRouter)

beforeEach(() => vi.clearAllMocks())

describe('GET /api/v1/ml/presets', () => {
  it('returns the preset table for a known (gameId, algorithm) pair', async () => {
    const res = await request(app).get('/api/v1/ml/presets?gameId=tic-tac-toe&algorithm=qlearning')
    expect(res.status).toBe(200)
    expect(res.body.gameId).toBe('tic-tac-toe')
    expect(res.body.algorithm).toBe('qlearning')
    expect(Array.isArray(res.body.presets)).toBe(true)
    expect(res.body.presets.length).toBeGreaterThan(0)
    // Each preset has a name + iterations + expectedDurationMs.
    for (const p of res.body.presets) {
      expect(p).toHaveProperty('name')
      expect(p).toHaveProperty('iterations')
      expect(p).toHaveProperty('expectedDurationMs')
    }
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('returns an empty list for unknown (gameId, algorithm)', async () => {
    const res = await request(app).get('/api/v1/ml/presets?gameId=connect-four&algorithm=qlearning')
    expect(res.status).toBe(200)
    expect(res.body.presets).toEqual([])
  })

  it('400s when gameId is missing', async () => {
    const res = await request(app).get('/api/v1/ml/presets?algorithm=qlearning')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/gameId and algorithm/)
  })

  it('400s when algorithm is missing', async () => {
    const res = await request(app).get('/api/v1/ml/presets?gameId=tic-tac-toe')
    expect(res.status).toBe(400)
  })
})
