// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.7 — GET /api/v1/ml/sessions/:id/metrics contract.
 *
 * The endpoint surfaces TrainingMetric rows the A3a multi-curve eval
 * already writes. The frontend StackedCurvesChart groups by
 * opponentLabel and renders one stacked area per group; ordering must
 * be (episodeNum asc, opponentLabel asc) so the chart can render
 * incrementally without re-sorting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.auth = { userId: 'ba_user_1' }; next() },
  isAdmin:     () => false,
}))

const { mockGetSession, mockFindMany } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockFindMany:   vi.fn(),
}))

vi.mock('../../services/mlService.js', () => ({
  getSession:           mockGetSession,
  // Required no-op stubs (module-load surface).
  listModels:           vi.fn(), getModel: vi.fn(), getSystemConfig: vi.fn(),
  createModel:          vi.fn(), updateModel: vi.fn(), deleteModel: vi.fn(),
  resetModel:           vi.fn(), cloneModel: vi.fn(), startTraining: vi.fn(),
  startFrontendSession: vi.fn(), cancelSession: vi.fn(), getModelSessions: vi.fn(),
  getSessionEpisodes:   vi.fn(), listCheckpoints: vi.fn(), saveCheckpoint: vi.fn(),
  restoreCheckpoint:    vi.fn(), getEloHistory: vi.fn(), getOpeningBook: vi.fn(),
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

vi.mock('../../ai/ruleBased.js', () => ({ invalidateRuleSetCache: vi.fn() }))

vi.mock('../../lib/db.js', () => ({
  default: {
    user: {}, botSkill: {}, trainingSession: {},
    trainingMetric: { findMany: mockFindMany },
  },
}))

vi.mock('../../services/trainingRuntime.js', () => ({
  resolveTrainingRuntime: vi.fn(),
}))

const mlRouter = (await import('../ml.js')).default

const app = express()
app.use(express.json())
app.use('/api/v1/ml', mlRouter)

beforeEach(() => vi.clearAllMocks())

describe('GET /api/v1/ml/sessions/:id/metrics', () => {
  it('404s when the session does not exist', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await request(app).get('/api/v1/ml/sessions/sess_missing/metrics')
    expect(res.status).toBe(404)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('returns an empty array when the session has no eval metrics yet', async () => {
    mockGetSession.mockResolvedValue({ id: 'sess_1', status: 'RUNNING' })
    mockFindMany.mockResolvedValue([])
    const res = await request(app).get('/api/v1/ml/sessions/sess_1/metrics')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ metrics: [] })
  })

  it('passes through all eval points with the right select + ordering', async () => {
    mockGetSession.mockResolvedValue({ id: 'sess_1' })
    mockFindMany.mockResolvedValue([
      { episodeNum: 1000, opponentLabel: 'easy',    wins: 18, draws: 1, losses: 1, asFirstMover: null },
      { episodeNum: 1000, opponentLabel: 'medium',  wins: 12, draws: 4, losses: 4, asFirstMover: null },
      { episodeNum: 1000, opponentLabel: 'primary', wins:  8, draws: 6, losses: 6, asFirstMover: null },
      { episodeNum: 2000, opponentLabel: 'easy',    wins: 20, draws: 0, losses: 0, asFirstMover: null },
    ])
    const res = await request(app).get('/api/v1/ml/sessions/sess_1/metrics')
    expect(res.status).toBe(200)
    expect(res.body.metrics).toHaveLength(4)
    expect(res.body.metrics[0]).toMatchObject({ episodeNum: 1000, opponentLabel: 'easy' })

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where:   { sessionId: 'sess_1' },
      orderBy: [{ episodeNum: 'asc' }, { opponentLabel: 'asc' }],
      select: expect.objectContaining({
        episodeNum: true, opponentLabel: true, wins: true,
        draws: true, losses: true, asFirstMover: true,
      }),
    }))
  })

  it('includes asFirstMover when split (Master curve / AlphaZero phase B)', async () => {
    mockGetSession.mockResolvedValue({ id: 'sess_az' })
    mockFindMany.mockResolvedValue([
      { episodeNum: 5000, opponentLabel: 'master', wins: 3, draws: 7, losses: 0, asFirstMover: true  },
      { episodeNum: 5000, opponentLabel: 'master', wins: 2, draws: 8, losses: 0, asFirstMover: false },
    ])
    const res = await request(app).get('/api/v1/ml/sessions/sess_az/metrics')
    expect(res.status).toBe(200)
    expect(res.body.metrics[0].asFirstMover).toBe(true)
    expect(res.body.metrics[1].asFirstMover).toBe(false)
  })
})
