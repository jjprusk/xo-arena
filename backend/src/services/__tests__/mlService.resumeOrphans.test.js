// A3a.9 — resumeOrphanedSessions contract tests.
//
// Orphans are RUNNING sessions whose process died (deploy, crash, OOM).
// On boot, each one should either resume from its latest TrainingCheckpoint
// or be marked FAILED so the model unlocks. We mock the DB and assert on
// the resulting writes + that _runTraining was invoked with the right
// resume params.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../services/userService.js', () => ({ resetBotElo: vi.fn() }))
vi.mock('../../lib/eventStream.js', () => ({ appendToStream: vi.fn() }))
vi.mock('../../services/journeyService.js', () => ({ completeStep: vi.fn() }))
vi.mock('../../services/discoveryRewardsService.js', () => ({ grantDiscoveryReward: vi.fn() }))

vi.mock('@xo-arena/ai', () => ({
  DEFAULT_CONFIG: {},
  QLearningEngine:    vi.fn(),
  SarsaEngine:        vi.fn(),
  MonteCarloEngine:   vi.fn(),
  PolicyGradientEngine: vi.fn(),
  DQNEngine:          vi.fn(),
  AlphaZeroEngine:    vi.fn(),
  runEpisode:         vi.fn(),
  minimaxMove:        vi.fn(),
  getWinner:          vi.fn(),
  isBoardFull:        vi.fn(),
  getEmptyCells:      vi.fn(),
  opponent:           vi.fn(),
  proportionPValue:   vi.fn(),
  twoProportionPValue: vi.fn(),
}))

const {
  mockSessionFindMany,
  mockSessionUpdate,
  mockCheckpointFindFirst,
  mockBotSkillUpdate,
} = vi.hoisted(() => ({
  mockSessionFindMany:     vi.fn(),
  mockSessionUpdate:       vi.fn().mockResolvedValue({}),
  mockCheckpointFindFirst: vi.fn(),
  mockBotSkillUpdate:      vi.fn().mockResolvedValue({}),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    trainingSession:    { findMany: mockSessionFindMany, update: mockSessionUpdate, findUnique: vi.fn(), count: vi.fn(), create: vi.fn() },
    trainingCheckpoint: { findFirst: mockCheckpointFindFirst, upsert: vi.fn(), create: vi.fn() },
    botSkill:           { update: mockBotSkillUpdate, findUnique: vi.fn(), count: vi.fn() },
    systemConfig:       { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    user:               { findUnique: vi.fn() },
    mLCheckpoint:       { create: vi.fn() },
    trainingEpisode:    { createMany: vi.fn() },
    trainingMetric:     { createMany: vi.fn() },
    $transaction:       vi.fn(),
  },
}))

// Intercept the background loop start so we can assert on the resume call
// without spinning up a real engine.
const setImmediateSpy = vi.fn()
vi.stubGlobal('setImmediate', setImmediateSpy)

const { resumeOrphanedSessions } = await import('../mlService.js')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resumeOrphanedSessions (A3a.9)', () => {
  it('no orphans: returns empty array, no writes', async () => {
    mockSessionFindMany.mockResolvedValue([])
    const result = await resumeOrphanedSessions()
    expect(result).toEqual([])
    expect(mockSessionUpdate).not.toHaveBeenCalled()
    expect(setImmediateSpy).not.toHaveBeenCalled()
  })

  it('orphan with a checkpoint: schedules a resumed _runTraining via setImmediate', async () => {
    mockSessionFindMany.mockResolvedValue([
      {
        id: 'sess-1',
        modelId: 'model-1',
        mode: 'SELF_PLAY',
        iterations: 5000,
        config: { x: 1 },
        status: 'RUNNING',
        model: { id: 'model-1', algorithm: 'qlearning', gameId: 'tic-tac-toe', config: {}, weights: {}, totalEpisodes: 0 },
      },
    ])
    mockCheckpointFindFirst.mockResolvedValue({
      id: 'cp-1',
      sessionId: 'sess-1',
      episodeNum: 2000,
      weights: { trained: true },
      runtimeState: { epsilon: 0.3 },
    })

    const result = await resumeOrphanedSessions()

    expect(result).toEqual([{ sessionId: 'sess-1', action: 'resumed', from: 2000 }])
    expect(setImmediateSpy).toHaveBeenCalledTimes(1)
    // No session-status writes — the resumed loop owns the lifecycle.
    expect(mockSessionUpdate).not.toHaveBeenCalled()
  })

  it('orphan with no checkpoint: marks FAILED and unlocks the model', async () => {
    mockSessionFindMany.mockResolvedValue([
      {
        id: 'sess-2',
        modelId: 'model-2',
        mode: 'SELF_PLAY',
        iterations: 5000,
        config: {},
        status: 'RUNNING',
        model: { id: 'model-2', algorithm: 'qlearning', gameId: 'tic-tac-toe', config: {}, weights: {}, totalEpisodes: 0 },
      },
    ])
    mockCheckpointFindFirst.mockResolvedValue(null)

    const result = await resumeOrphanedSessions()

    expect(result).toEqual([{ sessionId: 'sess-2', action: 'failed_no_checkpoint' }])
    expect(mockSessionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sess-2' },
      data: expect.objectContaining({
        status: 'FAILED',
        summary: { resumeError: 'no checkpoint available' },
      }),
    }))
    expect(mockBotSkillUpdate).toHaveBeenCalledWith({
      where: { id: 'model-2' },
      data:  { status: 'IDLE' },
    })
    expect(setImmediateSpy).not.toHaveBeenCalled()
  })

  it('mixed orphans: resumes one, fails the other; results array tags each by action', async () => {
    mockSessionFindMany.mockResolvedValue([
      {
        id: 'sess-good',
        modelId: 'model-a',
        mode: 'SELF_PLAY', iterations: 5000, config: {}, status: 'RUNNING',
        model: { id: 'model-a', algorithm: 'qlearning', gameId: 'tic-tac-toe', config: {}, weights: {}, totalEpisodes: 0 },
      },
      {
        id: 'sess-orphan',
        modelId: 'model-b',
        mode: 'SELF_PLAY', iterations: 5000, config: {}, status: 'RUNNING',
        model: { id: 'model-b', algorithm: 'qlearning', gameId: 'tic-tac-toe', config: {}, weights: {}, totalEpisodes: 0 },
      },
    ])
    // First call returns a checkpoint; second returns null.
    mockCheckpointFindFirst
      .mockResolvedValueOnce({
        id: 'cp', sessionId: 'sess-good', episodeNum: 1000,
        weights: {}, runtimeState: { epsilon: 0.5 },
      })
      .mockResolvedValueOnce(null)

    const result = await resumeOrphanedSessions()

    expect(result).toEqual([
      { sessionId: 'sess-good',   action: 'resumed', from: 1000 },
      { sessionId: 'sess-orphan', action: 'failed_no_checkpoint' },
    ])
  })

  it('per-session error is isolated: other sessions still process', async () => {
    mockSessionFindMany.mockResolvedValue([
      {
        id: 'sess-bad',
        modelId: 'model-a',
        mode: 'SELF_PLAY', iterations: 5000, config: {}, status: 'RUNNING',
        model: null,  // will trigger an error path inside the loop
      },
      {
        id: 'sess-ok',
        modelId: 'model-b',
        mode: 'SELF_PLAY', iterations: 5000, config: {}, status: 'RUNNING',
        model: { id: 'model-b', algorithm: 'qlearning', gameId: 'tic-tac-toe', config: {}, weights: {}, totalEpisodes: 0 },
      },
    ])
    // First findFirst throws; second returns a checkpoint.
    mockCheckpointFindFirst
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        id: 'cp', sessionId: 'sess-ok', episodeNum: 500,
        weights: {}, runtimeState: { epsilon: 0.4 },
      })

    const result = await resumeOrphanedSessions()

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ sessionId: 'sess-bad', action: 'error' })
    expect(result[1]).toMatchObject({ sessionId: 'sess-ok',  action: 'resumed', from: 500 })
  })
})
