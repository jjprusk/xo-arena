// Copyright © 2026 Joe Pruskowski. All rights reserved.
//
// A3b.2b — `startTraining` dispatch routing and `resumeOrphanedSessions`
// worker-aware filtering.
//
// Two flag positions; two startTraining outcomes:
//   ml.useWorker=false → setImmediate(_runTraining) (legacy path)
//   ml.useWorker=true  → enqueueTrainingStart(sessionId), no setImmediate
//
// And one filter assertion: orphan scan skips sessions tagged
// dispatch:'worker' regardless of pausedAt state — BullMQ owns them.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../services/userService.js',          () => ({ resetBotElo: vi.fn() }))
vi.mock('../../lib/eventStream.js',               () => ({ appendToStream: vi.fn() }))
vi.mock('../../services/journeyService.js',       () => ({ completeStep: vi.fn() }))
vi.mock('../../services/discoveryRewardsService.js', () => ({ grantDiscoveryReward: vi.fn() }))

vi.mock('@xo-arena/ai', () => ({
  DEFAULT_CONFIG: {},
  QLearningEngine:    vi.fn(), SarsaEngine: vi.fn(), MonteCarloEngine: vi.fn(),
  PolicyGradientEngine: vi.fn(), DQNEngine: vi.fn(), AlphaZeroEngine: vi.fn(),
  runEpisode: vi.fn(), minimaxMove: vi.fn(),
  getWinner: vi.fn(), isBoardFull: vi.fn(), getEmptyCells: vi.fn(), opponent: vi.fn(),
  proportionPValue: vi.fn(), twoProportionPValue: vi.fn(),
}))

const {
  mockSessionCreate, mockSessionFindMany, mockSessionFindUnique,
  mockBotSkillUpdate, mockBotSkillFindUnique, mockBotSkillCount,
  mockSystemConfigFindUnique, mockCheckpointFindFirst,
  mockEnqueueTrainingStart,
} = vi.hoisted(() => ({
  mockSessionCreate:           vi.fn(),
  mockSessionFindMany:         vi.fn(),
  mockSessionFindUnique:       vi.fn(),
  mockBotSkillUpdate:          vi.fn().mockResolvedValue({}),
  mockBotSkillFindUnique:      vi.fn(),
  mockBotSkillCount:           vi.fn().mockResolvedValue(0),
  mockSystemConfigFindUnique:  vi.fn(),
  mockCheckpointFindFirst:     vi.fn(),
  mockEnqueueTrainingStart:    vi.fn().mockResolvedValue({ id: 'job_1', name: 'training:start' }),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    trainingSession:    { create: mockSessionCreate, findMany: mockSessionFindMany, findUnique: mockSessionFindUnique, update: vi.fn(), count: vi.fn() },
    botSkill:           { update: mockBotSkillUpdate, findUnique: mockBotSkillFindUnique, count: mockBotSkillCount },
    trainingCheckpoint: { findFirst: mockCheckpointFindFirst },
    systemConfig:       { findUnique: mockSystemConfigFindUnique, upsert: vi.fn() },
    user:               { findUnique: vi.fn() },
    mLCheckpoint:       { create: vi.fn() },
    trainingEpisode:    { createMany: vi.fn() },
    trainingMetric:     { createMany: vi.fn() },
  },
}))

vi.mock('../../queue/trainingQueue.js', () => ({
  enqueueTrainingStart: mockEnqueueTrainingStart,
  getTrainingQueue:     vi.fn(),
  TRAINING_QUEUE_NAME:  'training',
}))

const setImmediateSpy = vi.fn()
vi.stubGlobal('setImmediate', setImmediateSpy)

const { startTraining, resumeOrphanedSessions } = await import('../mlService.js')

beforeEach(() => {
  vi.clearAllMocks()
  mockBotSkillFindUnique.mockResolvedValue({
    id: 'model-1',
    algorithm: 'qlearning',
    gameId: 'tic-tac-toe',
    status: 'IDLE',
    config: {},
    weights: {},
    totalEpisodes: 0,
    maxEpisodes: 100_000,
    createdBy: null,
  })
  mockSessionCreate.mockImplementation(({ data }) =>
    Promise.resolve({ id: 'sess_new', ...data, model: null })
  )
})

function systemConfigReturns(key, value) {
  mockSystemConfigFindUnique.mockImplementation(({ where }) => {
    if (where?.key === key) return Promise.resolve({ value })
    return Promise.resolve(null)
  })
}

describe('startTraining — dispatch routing (A3b.2b)', () => {
  it('default (ml.useWorker unset): runs in-process via setImmediate, tags dispatch=in-process', async () => {
    mockSystemConfigFindUnique.mockResolvedValue(null)

    const session = await startTraining('model-1', { mode: 'SELF_PLAY', iterations: 100, config: {} })

    expect(setImmediateSpy).toHaveBeenCalledTimes(1)
    expect(mockEnqueueTrainingStart).not.toHaveBeenCalled()
    // The persisted config carries the dispatch tag so the orphan resumer
    // and crash-recovery test know which path created the session.
    const createArgs = mockSessionCreate.mock.calls[0][0].data
    expect(createArgs.config.dispatch).toBe('in-process')
    expect(session.id).toBe('sess_new')
  })

  it('ml.useWorker=true: enqueues a training:start job, never setImmediate, tags dispatch=worker', async () => {
    systemConfigReturns('ml.useWorker', true)

    const session = await startTraining('model-1', { mode: 'SELF_PLAY', iterations: 100, config: {} })

    expect(mockEnqueueTrainingStart).toHaveBeenCalledTimes(1)
    expect(mockEnqueueTrainingStart).toHaveBeenCalledWith('sess_new')
    expect(setImmediateSpy).not.toHaveBeenCalled()
    const createArgs = mockSessionCreate.mock.calls[0][0].data
    expect(createArgs.config.dispatch).toBe('worker')
    expect(session.id).toBe('sess_new')
  })
})

describe('resumeOrphanedSessions — worker-dispatched skip (A3b.2b)', () => {
  it('orphan tagged dispatch=worker is not picked up by the backend boot scan', async () => {
    mockSessionFindMany.mockResolvedValue([
      {
        id: 'sess-worker',
        modelId: 'model-a',
        mode: 'SELF_PLAY',
        iterations: 5000,
        config: { dispatch: 'worker' },
        status: 'RUNNING',
        model: { id: 'model-a', algorithm: 'qlearning', gameId: 'tic-tac-toe', config: {}, weights: {}, totalEpisodes: 0 },
      },
    ])

    const result = await resumeOrphanedSessions()

    // Filtered out entirely — no checkpoint lookup, no setImmediate.
    expect(result).toEqual([])
    expect(mockCheckpointFindFirst).not.toHaveBeenCalled()
    expect(setImmediateSpy).not.toHaveBeenCalled()
  })

  it('orphan with no dispatch tag (legacy) still resumes via setImmediate', async () => {
    mockSessionFindMany.mockResolvedValue([
      {
        id: 'sess-legacy',
        modelId: 'model-b',
        mode: 'SELF_PLAY',
        iterations: 5000,
        config: {},
        status: 'RUNNING',
        model: { id: 'model-b', algorithm: 'qlearning', gameId: 'tic-tac-toe', config: {}, weights: {}, totalEpisodes: 0 },
      },
    ])
    mockCheckpointFindFirst.mockResolvedValue({
      sessionId: 'sess-legacy',
      episodeNum: 1000,
      weights: {},
      runtimeState: { epsilon: 0.5 },
    })

    const result = await resumeOrphanedSessions()
    expect(result).toEqual([{ sessionId: 'sess-legacy', action: 'resumed', from: 1000 }])
    expect(setImmediateSpy).toHaveBeenCalledTimes(1)
  })

  it('mixed: worker session is skipped, in-process session is resumed', async () => {
    mockSessionFindMany.mockResolvedValue([
      {
        id: 'sess-worker',
        modelId: 'model-w',
        mode: 'SELF_PLAY', iterations: 5000,
        config: { dispatch: 'worker' },
        status: 'RUNNING',
        model: { id: 'model-w', algorithm: 'qlearning', gameId: 'tic-tac-toe', config: {}, weights: {}, totalEpisodes: 0 },
      },
      {
        id: 'sess-in-process',
        modelId: 'model-i',
        mode: 'SELF_PLAY', iterations: 5000,
        config: { dispatch: 'in-process' },
        status: 'RUNNING',
        model: { id: 'model-i', algorithm: 'qlearning', gameId: 'tic-tac-toe', config: {}, weights: {}, totalEpisodes: 0 },
      },
    ])
    mockCheckpointFindFirst.mockResolvedValue({
      sessionId: 'sess-in-process',
      episodeNum: 750,
      weights: {},
      runtimeState: {},
    })

    const result = await resumeOrphanedSessions()
    expect(result).toEqual([{ sessionId: 'sess-in-process', action: 'resumed', from: 750 }])
    expect(setImmediateSpy).toHaveBeenCalledTimes(1)
  })
})
