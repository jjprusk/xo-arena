// A3a.10 — pause / resume contract tests.
//
// pauseSession just sets a signal — the actual checkpoint + status flip
// happens inside _runTraining's pause check, which we don't exercise here
// (covered indirectly by the resume tests + manual QA). resumeSession is
// the more interesting unit: it must reject unpaused sessions, demand a
// checkpoint, and start the loop with the correct resume params.

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
  QLearningEngine: vi.fn(), SarsaEngine: vi.fn(), MonteCarloEngine: vi.fn(),
  PolicyGradientEngine: vi.fn(), DQNEngine: vi.fn(), AlphaZeroEngine: vi.fn(),
  runEpisode: vi.fn(), minimaxMove: vi.fn(),
  getWinner: vi.fn(), isBoardFull: vi.fn(), getEmptyCells: vi.fn(),
  opponent: vi.fn(), proportionPValue: vi.fn(), twoProportionPValue: vi.fn(),
}))

const {
  mockSessionFindUnique,
  mockSessionUpdate,
  mockCheckpointFindFirst,
  mockBotSkillUpdate,
} = vi.hoisted(() => ({
  mockSessionFindUnique:   vi.fn(),
  mockSessionUpdate:       vi.fn().mockResolvedValue({}),
  mockCheckpointFindFirst: vi.fn(),
  mockBotSkillUpdate:      vi.fn().mockResolvedValue({}),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    trainingSession:    { findUnique: mockSessionFindUnique, update: mockSessionUpdate, findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
    trainingCheckpoint: { findFirst: mockCheckpointFindFirst, upsert: vi.fn(), create: vi.fn() },
    botSkill:           { update: mockBotSkillUpdate, findUnique: vi.fn(), count: vi.fn() },
    user:               { findUnique: vi.fn() },
    systemConfig:       { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    mLCheckpoint:       { create: vi.fn() },
    trainingEpisode:    { createMany: vi.fn() },
    trainingMetric:     { createMany: vi.fn() },
    $transaction:       vi.fn(),
  },
}))

const setImmediateSpy = vi.fn()
vi.stubGlobal('setImmediate', setImmediateSpy)

const { pauseSession, resumeSession } = await import('../mlService.js')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('pauseSession (A3a.10)', () => {
  it('RUNNING session: returns the row and adds to the pause signal Set', async () => {
    mockSessionFindUnique.mockResolvedValue({
      id: 'sess-1', status: 'RUNNING', pausedAt: null,
    })

    const result = await pauseSession('sess-1')
    expect(result.id).toBe('sess-1')
    // Loop-side effect is what produces the DB write; pauseSession itself
    // touches no rows.
    expect(mockSessionUpdate).not.toHaveBeenCalled()
  })

  it('non-RUNNING session: throws', async () => {
    mockSessionFindUnique.mockResolvedValue({ id: 'sess-1', status: 'PENDING', pausedAt: null })
    await expect(pauseSession('sess-1')).rejects.toThrow(/expected RUNNING/)
  })

  it('already paused: throws', async () => {
    mockSessionFindUnique.mockResolvedValue({ id: 'sess-1', status: 'RUNNING', pausedAt: new Date() })
    await expect(pauseSession('sess-1')).rejects.toThrow(/already paused/)
  })

  it('unknown session: throws Session not found', async () => {
    mockSessionFindUnique.mockResolvedValue(null)
    await expect(pauseSession('nope')).rejects.toThrow(/not found/)
  })
})

describe('resumeSession (A3a.10)', () => {
  beforeEach(() => {
    mockSessionFindUnique.mockResolvedValue({
      id: 'sess-1',
      modelId: 'model-1',
      mode: 'SELF_PLAY', iterations: 5000, config: {}, status: 'PENDING',
      pausedAt: new Date('2026-05-19T10:00:00Z'),
      model: { id: 'model-1', algorithm: 'qlearning', gameId: 'tic-tac-toe', config: {}, weights: {}, status: 'IDLE', totalEpisodes: 0 },
    })
    mockCheckpointFindFirst.mockResolvedValue({
      id: 'cp-1', sessionId: 'sess-1', episodeNum: 2000,
      weights: { restored: true },
      runtimeState: { epsilon: 0.25 },
    })
  })

  it('paused session with checkpoint: clears pausedAt, flips to RUNNING, launches _runTraining', async () => {
    await resumeSession('sess-1')

    // First update: clear pausedAt + flip status.
    expect(mockSessionUpdate.mock.calls[0][0]).toMatchObject({
      where: { id: 'sess-1' },
      data:  { pausedAt: null, status: 'RUNNING' },
    })
    // Model relocks to TRAINING.
    expect(mockBotSkillUpdate).toHaveBeenCalledWith({
      where: { id: 'model-1' },
      data:  { status: 'TRAINING' },
    })
    // Loop scheduled.
    expect(setImmediateSpy).toHaveBeenCalledTimes(1)
  })

  it('paused session, model busy: queues the resume instead of launching', async () => {
    mockSessionFindUnique.mockResolvedValue({
      id: 'sess-1', modelId: 'model-1',
      mode: 'SELF_PLAY', iterations: 5000, config: {}, status: 'PENDING',
      pausedAt: new Date(),
      model: { id: 'model-1', algorithm: 'qlearning', gameId: 'tic-tac-toe', config: {}, weights: {}, status: 'TRAINING', totalEpisodes: 0 },
    })

    await resumeSession('sess-1')

    expect(mockBotSkillUpdate).not.toHaveBeenCalled()
    expect(setImmediateSpy).not.toHaveBeenCalled()
  })

  it('not paused: throws', async () => {
    mockSessionFindUnique.mockResolvedValue({
      id: 'sess-1', modelId: 'model-1', status: 'RUNNING', pausedAt: null,
      mode: 'SELF_PLAY', iterations: 5000, config: {},
      model: { id: 'model-1', algorithm: 'qlearning', gameId: 'tic-tac-toe', config: {}, weights: {}, status: 'TRAINING' },
    })
    await expect(resumeSession('sess-1')).rejects.toThrow(/not paused/)
  })

  it('no checkpoint exists: throws Cannot resume', async () => {
    mockCheckpointFindFirst.mockResolvedValue(null)
    await expect(resumeSession('sess-1')).rejects.toThrow(/no checkpoint available/)
    expect(mockSessionUpdate).not.toHaveBeenCalled()
    expect(setImmediateSpy).not.toHaveBeenCalled()
  })

  it('unknown session: throws Session not found', async () => {
    mockSessionFindUnique.mockResolvedValue(null)
    await expect(resumeSession('nope')).rejects.toThrow(/not found/)
  })
})
