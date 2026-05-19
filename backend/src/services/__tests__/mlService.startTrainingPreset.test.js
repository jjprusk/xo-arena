// A3a.4 — preset wiring for mlService.startTraining + startFrontendSession.
//
// Covers: preset resolves to iterations + expectedDurationMs, persists onto
// the session row, throws for unknown presets, and remains a no-op when not
// provided.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../services/userService.js', () => ({
  resetBotElo: vi.fn(),
}))

vi.mock('../../lib/eventStream.js', () => ({
  appendToStream: vi.fn().mockResolvedValue('1-0'),
}))

vi.mock('../../services/journeyService.js', () => ({
  completeStep: vi.fn(),
}))

vi.mock('../../services/discoveryRewardsService.js', () => ({
  grantDiscoveryReward: vi.fn(),
}))

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
  mockSystemConfigUpsert,
  mockSystemConfigFindUnique,
  mockBotSkillFindUnique,
  mockBotSkillUpdate,
  mockBotSkillCount,
  mockTrainingSessionCreate,
} = vi.hoisted(() => ({
  mockSystemConfigUpsert:        vi.fn(),
  mockSystemConfigFindUnique:    vi.fn().mockResolvedValue(null),
  mockBotSkillFindUnique:        vi.fn(),
  mockBotSkillUpdate:            vi.fn().mockResolvedValue({}),
  mockBotSkillCount:             vi.fn().mockResolvedValue(0),
  mockTrainingSessionCreate:     vi.fn(),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    systemConfig:    { findUnique: mockSystemConfigFindUnique, upsert: mockSystemConfigUpsert },
    botSkill:        { findUnique: mockBotSkillFindUnique, update: mockBotSkillUpdate, count: mockBotSkillCount },
    trainingSession: { create: mockTrainingSessionCreate },
  },
}))

// setImmediate keeps the background _runTraining loop from inspecting our
// mocks during the assertion phase — replace with a no-op.
vi.stubGlobal('setImmediate', vi.fn())

const { startTraining, startFrontendSession } = await import('../mlService.js')

const MODEL_ID = 'model-ttt-qlearn'

beforeEach(() => {
  vi.clearAllMocks()
  mockBotSkillFindUnique.mockResolvedValue({
    id:            MODEL_ID,
    gameId:        'tic-tac-toe',
    algorithm:     'qlearning',
    status:        'IDLE',
    maxEpisodes:   100_000,
    totalEpisodes: 0,
    config:        {},
    weights:       {},
  })
  mockTrainingSessionCreate.mockImplementation(async ({ data }) => ({
    id: 'sess-1',
    ...data,
  }))
  mockSystemConfigFindUnique.mockResolvedValue(null)  // all limits default to off
})

describe('mlService.startTraining — preset support (A3a.4)', () => {
  it("'standard' preset resolves to qlearning's 50,000 episodes + 30-minute ETA", async () => {
    const session = await startTraining(MODEL_ID, { mode: 'SELF_PLAY', preset: 'standard' })

    expect(mockTrainingSessionCreate).toHaveBeenCalledTimes(1)
    const dataArg = mockTrainingSessionCreate.mock.calls[0][0].data
    expect(dataArg.iterations).toBe(50_000)
    expect(dataArg.preset).toBe('standard')
    expect(dataArg.expectedDurationMs).toBe(30 * 60 * 1000)
    expect(session.preset).toBe('standard')
  })

  it("'quick' preset overrides any iterations the caller passes", async () => {
    await startTraining(MODEL_ID, { mode: 'SELF_PLAY', iterations: 99_999, preset: 'quick' })

    const dataArg = mockTrainingSessionCreate.mock.calls[0][0].data
    expect(dataArg.iterations).toBe(5_000)  // qlearning quick, not 99,999
    expect(dataArg.preset).toBe('quick')
  })

  it('throws for an unknown preset', async () => {
    await expect(
      startTraining(MODEL_ID, { mode: 'SELF_PLAY', preset: 'extreme' })
    ).rejects.toThrow(/Unknown preset/)
    expect(mockTrainingSessionCreate).not.toHaveBeenCalled()
  })

  it('throws for an unknown (algorithm, preset) combination', async () => {
    mockBotSkillFindUnique.mockResolvedValue({
      id: MODEL_ID, gameId: 'connect-four', algorithm: 'qlearning', status: 'IDLE',
      maxEpisodes: 100_000, totalEpisodes: 0, config: {}, weights: {},
    })
    await expect(
      startTraining(MODEL_ID, { mode: 'SELF_PLAY', preset: 'quick' })
    ).rejects.toThrow(/Unknown preset/)
  })

  it('without preset: preserves legacy behaviour — iterations arg wins, preset/ETA stored null', async () => {
    await startTraining(MODEL_ID, { mode: 'SELF_PLAY', iterations: 1_000 })

    const dataArg = mockTrainingSessionCreate.mock.calls[0][0].data
    expect(dataArg.iterations).toBe(1_000)
    expect(dataArg.preset).toBeNull()
    expect(dataArg.expectedDurationMs).toBeNull()
  })

  it('queued path (model already TRAINING): also persists preset + ETA on the queued row', async () => {
    mockBotSkillFindUnique.mockResolvedValue({
      id: MODEL_ID, gameId: 'tic-tac-toe', algorithm: 'qlearning', status: 'TRAINING',
      maxEpisodes: 100_000, totalEpisodes: 0, config: {}, weights: {},
    })

    await startTraining(MODEL_ID, { mode: 'SELF_PLAY', preset: 'deep' })

    const dataArg = mockTrainingSessionCreate.mock.calls[0][0].data
    expect(dataArg.status).toBe('PENDING')
    expect(dataArg.iterations).toBe(100_000)
    expect(dataArg.preset).toBe('deep')
    expect(dataArg.expectedDurationMs).toBe(60 * 60 * 1000)
  })
})

describe('mlService.startFrontendSession — preset support (A3a.4)', () => {
  it('resolves preset and persists alongside the frontend marker config', async () => {
    await startFrontendSession(MODEL_ID, { mode: 'VS_MINIMAX', preset: 'quick' })

    const dataArg = mockTrainingSessionCreate.mock.calls[0][0].data
    expect(dataArg.iterations).toBe(5_000)
    expect(dataArg.preset).toBe('quick')
    expect(dataArg.expectedDurationMs).toBe(5 * 60 * 1000)
    expect(dataArg.config).toMatchObject({ frontend: true })
  })
})
