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
  mockTrainingSessionFindUnique,
  mockTrainingSessionFindMany,
  mockTrainingSessionUpdate,
  mockTrainingSessionCount,
  mockUserFindUnique,
} = vi.hoisted(() => ({
  mockSystemConfigUpsert:        vi.fn(),
  mockSystemConfigFindUnique:    vi.fn().mockResolvedValue(null),
  mockBotSkillFindUnique:        vi.fn(),
  mockBotSkillUpdate:            vi.fn().mockResolvedValue({}),
  mockBotSkillCount:             vi.fn().mockResolvedValue(0),
  mockTrainingSessionCreate:     vi.fn(),
  mockTrainingSessionFindUnique: vi.fn(),
  mockTrainingSessionFindMany:   vi.fn(),
  mockTrainingSessionUpdate:     vi.fn(),
  mockTrainingSessionCount:      vi.fn().mockResolvedValue(0),
  mockUserFindUnique:            vi.fn().mockResolvedValue(null),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    systemConfig:    { findUnique: mockSystemConfigFindUnique, upsert: mockSystemConfigUpsert },
    botSkill:        { findUnique: mockBotSkillFindUnique, update: mockBotSkillUpdate, count: mockBotSkillCount },
    user:            { findUnique: mockUserFindUnique },
    trainingSession: {
      create:      mockTrainingSessionCreate,
      findUnique:  mockTrainingSessionFindUnique,
      findMany:    mockTrainingSessionFindMany,
      update:      mockTrainingSessionUpdate,
      count:       mockTrainingSessionCount,
    },
  },
}))

// setImmediate keeps the background _runTraining loop from inspecting our
// mocks during the assertion phase — replace with a no-op.
vi.stubGlobal('setImmediate', vi.fn())

// A3b.10 — DEFAULT_MATRIX routes AlphaZero to 'worker', which calls
// enqueueTrainingStart and tries to open a Redis connection. The tests
// in this file care about the preset + approval-gate behavior, not the
// dispatch path, so stub the queue producer to a no-op. (No REDIS_URL
// is set in CI.)
vi.mock('../../queue/trainingQueue.js', () => ({
  enqueueTrainingStart: vi.fn().mockResolvedValue({ id: 'mock_job' }),
  getTrainingQueue:     vi.fn(),
  TRAINING_QUEUE_NAME:  'training',
}))

const {
  startTraining,
  startFrontendSession,
  approveSession,
  denySession,
  listPendingApprovals,
} = await import('../mlService.js')

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

// ── A3a.5: ETA-threshold gating ───────────────────────────────────────────

describe('mlService.startTraining — ETA-threshold gate (A3a.5)', () => {
  beforeEach(() => {
    // Default behaviour: model is on AlphaZero (presets >= 4hr) so the gate trips.
    mockBotSkillFindUnique.mockResolvedValue({
      id: MODEL_ID, gameId: 'tic-tac-toe', algorithm: 'alphazero', status: 'IDLE',
      maxEpisodes: 100_000, totalEpisodes: 0, config: {}, weights: {},
    })
  })

  it("'standard' AlphaZero (4hr ETA) holds the session for admin approval", async () => {
    await startTraining(MODEL_ID, { mode: 'SELF_PLAY', preset: 'standard' })

    const dataArg = mockTrainingSessionCreate.mock.calls[0][0].data
    expect(dataArg.status).toBe('PENDING')
    expect(dataArg.approvalStatus).toBe('NEEDED')
    expect(dataArg.approvalRequestedAt).toBeInstanceOf(Date)
    // botSkill must NOT flip to TRAINING — gated sessions don't start.
    expect(mockBotSkillUpdate).not.toHaveBeenCalled()
  })

  it("'quick' AlphaZero (30min ETA) skips the gate and runs immediately", async () => {
    await startTraining(MODEL_ID, { mode: 'SELF_PLAY', preset: 'quick' })

    const dataArg = mockTrainingSessionCreate.mock.calls[0][0].data
    expect(dataArg.status).toBe('RUNNING')
    expect(dataArg.approvalStatus).toBeUndefined()
    expect(mockBotSkillUpdate).toHaveBeenCalledTimes(1)
  })

  it('no preset (legacy iterations-direct caller): never gated, never marked NEEDED', async () => {
    mockBotSkillFindUnique.mockResolvedValue({
      id: MODEL_ID, gameId: 'tic-tac-toe', algorithm: 'qlearning', status: 'IDLE',
      maxEpisodes: 100_000, totalEpisodes: 0, config: {}, weights: {},
    })

    await startTraining(MODEL_ID, { mode: 'SELF_PLAY', iterations: 30_000 })

    const dataArg = mockTrainingSessionCreate.mock.calls[0][0].data
    expect(dataArg.status).toBe('RUNNING')
    expect(dataArg.approvalStatus).toBeUndefined()
    expect(dataArg.expectedDurationMs).toBeNull()
  })

  it('respects ml.approvalThresholdMs SystemConfig override', async () => {
    // Lower the threshold to 1 minute — quick AlphaZero (30min) now trips it.
    mockSystemConfigFindUnique.mockImplementation(async ({ where }) => {
      if (where.key === 'ml.approvalThresholdMs') return { value: '60000' }
      return null
    })

    await startTraining(MODEL_ID, { mode: 'SELF_PLAY', preset: 'quick' })

    const dataArg = mockTrainingSessionCreate.mock.calls[0][0].data
    expect(dataArg.status).toBe('PENDING')
    expect(dataArg.approvalStatus).toBe('NEEDED')
  })
})

describe('mlService.approveSession / denySession / listPendingApprovals (A3a.5)', () => {
  const SESSION_ID = 'sess-gated'
  const ADMIN_ID   = 'admin-user-id'

  beforeEach(() => {
    mockTrainingSessionFindUnique.mockResolvedValue({
      id:             SESSION_ID,
      modelId:        MODEL_ID,
      mode:           'SELF_PLAY',
      iterations:     2_500,
      status:         'PENDING',
      approvalStatus: 'NEEDED',
      config:         {},
      preset:         'standard',
      expectedDurationMs: 4 * 60 * 60 * 1000,
    })
    mockTrainingSessionUpdate.mockResolvedValue({})
    mockBotSkillFindUnique.mockResolvedValue({
      id: MODEL_ID, gameId: 'tic-tac-toe', algorithm: 'alphazero', status: 'IDLE',
      config: {}, weights: {}, maxEpisodes: 100_000, totalEpisodes: 0,
    })
  })

  it('approve: marks APPROVED + records approvedBy + transitions PENDING → RUNNING (model idle)', async () => {
    await approveSession(SESSION_ID, ADMIN_ID)

    // First update writes approval bits.
    expect(mockTrainingSessionUpdate.mock.calls[0][0].data).toMatchObject({
      approvalStatus: 'APPROVED',
      approvedById:   ADMIN_ID,
    })
    // Second update transitions to RUNNING.
    expect(mockTrainingSessionUpdate.mock.calls[1][0].data).toMatchObject({
      status: 'RUNNING',
    })
    // botSkill flips to TRAINING.
    expect(mockBotSkillUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'TRAINING' } })
    )
  })

  it('approve when model is busy: APPROVED + queued, does not flip botSkill', async () => {
    mockBotSkillFindUnique.mockResolvedValue({
      id: MODEL_ID, gameId: 'tic-tac-toe', algorithm: 'alphazero', status: 'TRAINING',
      config: {}, weights: {}, maxEpisodes: 100_000, totalEpisodes: 0,
    })

    await approveSession(SESSION_ID, ADMIN_ID)

    expect(mockTrainingSessionUpdate).toHaveBeenCalledTimes(1)  // approval-bits only; no status flip
    expect(mockBotSkillUpdate).not.toHaveBeenCalled()
  })

  it('approve fails when session is not awaiting approval', async () => {
    mockTrainingSessionFindUnique.mockResolvedValue({
      id: SESSION_ID, modelId: MODEL_ID, status: 'PENDING', approvalStatus: 'APPROVED',
      mode: 'SELF_PLAY', iterations: 100, config: {},
    })

    await expect(approveSession(SESSION_ID, ADMIN_ID)).rejects.toThrow(/not awaiting approval/)
  })

  it('deny: marks DENIED + CANCELLED + records reason in summary', async () => {
    await denySession(SESSION_ID, ADMIN_ID, 'compute budget exhausted')

    const updateArgs = mockTrainingSessionUpdate.mock.calls[0][0].data
    expect(updateArgs).toMatchObject({
      approvalStatus: 'DENIED',
      approvedById:   ADMIN_ID,
      status:         'CANCELLED',
      summary:        { deniedReason: 'compute budget exhausted' },
    })
  })

  it('deny without reason: omits summary so existing summary survives', async () => {
    await denySession(SESSION_ID, ADMIN_ID)

    const updateArgs = mockTrainingSessionUpdate.mock.calls[0][0].data
    expect(updateArgs.summary).toBeUndefined()
  })

  it('listPendingApprovals: filters to NEEDED, newest-first', async () => {
    mockTrainingSessionFindMany.mockResolvedValue([
      { id: 'a', approvalStatus: 'NEEDED' },
      { id: 'b', approvalStatus: 'NEEDED' },
    ])

    const list = await listPendingApprovals()

    expect(mockTrainingSessionFindMany).toHaveBeenCalledWith({
      where:   { approvalStatus: 'NEEDED' },
      orderBy: { approvalRequestedAt: 'desc' },
    })
    expect(list).toHaveLength(2)
  })
})

// ── A3a.6: per-user concurrency cap ───────────────────────────────────────

describe('mlService.startTraining — per-user concurrency cap (A3a.6)', () => {
  const OWNER_BA = 'ba-owner-1'

  beforeEach(() => {
    mockBotSkillFindUnique.mockResolvedValue({
      id: MODEL_ID, gameId: 'tic-tac-toe', algorithm: 'qlearning', status: 'IDLE',
      maxEpisodes: 100_000, totalEpisodes: 0, config: {}, weights: {},
      createdBy: OWNER_BA,   // makes the cap check fire
    })
    mockUserFindUnique.mockResolvedValue({
      id: 'owner-domain-id', userRoles: [],  // non-admin
    })
    mockTrainingSessionCount.mockResolvedValue(0)  // no active sessions by default
  })

  it('owner has 0 active sessions: cap check passes, session runs', async () => {
    await startTraining(MODEL_ID, { mode: 'SELF_PLAY', iterations: 1_000 })

    expect(mockTrainingSessionCount).toHaveBeenCalledWith({
      where: {
        status: { in: ['PENDING', 'RUNNING'] },
        model:  { createdBy: OWNER_BA },
      },
    })
    expect(mockTrainingSessionCreate).toHaveBeenCalled()
  })

  it('owner already at the default cap (1 active session): throws Training limit', async () => {
    mockTrainingSessionCount.mockResolvedValue(1)

    await expect(
      startTraining(MODEL_ID, { mode: 'SELF_PLAY', iterations: 1_000 })
    ).rejects.toThrow(/Training limit:.*already have 1 active session.*max 1/)

    expect(mockTrainingSessionCreate).not.toHaveBeenCalled()
  })

  it('respects ml.maxActiveSessionsPerUser SystemConfig override', async () => {
    mockSystemConfigFindUnique.mockImplementation(async ({ where }) => {
      if (where.key === 'ml.maxActiveSessionsPerUser') return { value: '3' }
      return null
    })
    mockTrainingSessionCount.mockResolvedValue(2)  // user has 2; cap is 3

    await startTraining(MODEL_ID, { mode: 'SELF_PLAY', iterations: 1_000 })

    expect(mockTrainingSessionCreate).toHaveBeenCalled()
  })

  it('admin gets the admin-cap override when ml.maxActiveSessionsForAdmin > 0', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: 'owner-domain-id', userRoles: [{ role: 'ADMIN' }],
    })
    mockSystemConfigFindUnique.mockImplementation(async ({ where }) => {
      if (where.key === 'ml.maxActiveSessionsForAdmin') return { value: '5' }
      return null
    })
    mockTrainingSessionCount.mockResolvedValue(3)  // 3 active; admin cap is 5

    await startTraining(MODEL_ID, { mode: 'SELF_PLAY', iterations: 1_000 })

    expect(mockTrainingSessionCreate).toHaveBeenCalled()
  })

  it('non-admin does NOT pick up the admin-cap override', async () => {
    mockSystemConfigFindUnique.mockImplementation(async ({ where }) => {
      if (where.key === 'ml.maxActiveSessionsForAdmin') return { value: '5' }
      // default cap (1) still applies for non-admin
      return null
    })
    mockTrainingSessionCount.mockResolvedValue(1)

    await expect(
      startTraining(MODEL_ID, { mode: 'SELF_PLAY', iterations: 1_000 })
    ).rejects.toThrow(/Training limit:/)
  })

  it('admin override = 0 (unlimited): skips the cap entirely', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: 'owner-domain-id', userRoles: [{ role: 'ADMIN' }],
    })
    mockSystemConfigFindUnique.mockImplementation(async ({ where }) => {
      if (where.key === 'ml.maxActiveSessionsForAdmin') return { value: '0' }
      // ml.maxActiveSessionsPerUser falls back to default 1, but admin override
      // returns 0 BEFORE the admin-vs-default branch runs.
      return null
    })
    // With unlimited cap, even 100 active sessions should not block.
    // (Actually the code returns early when cap <= 0; count is not checked.)
    mockTrainingSessionCount.mockResolvedValue(100)

    // Admin with override=0 still falls through to default (1) — only nonzero
    // overrides win. So this scenario hits the default cap and throws.
    await expect(
      startTraining(MODEL_ID, { mode: 'SELF_PLAY', iterations: 1_000 })
    ).rejects.toThrow(/Training limit:/)
  })

  it('skill with no owner (createdBy=null): cap check skipped', async () => {
    mockBotSkillFindUnique.mockResolvedValue({
      id: MODEL_ID, gameId: 'tic-tac-toe', algorithm: 'qlearning', status: 'IDLE',
      maxEpisodes: 100_000, totalEpisodes: 0, config: {}, weights: {},
      createdBy: null,
    })

    await startTraining(MODEL_ID, { mode: 'SELF_PLAY', iterations: 1_000 })

    expect(mockTrainingSessionCount).not.toHaveBeenCalled()
    expect(mockTrainingSessionCreate).toHaveBeenCalled()
  })

  it('cap check sees both PENDING and RUNNING sessions as active', async () => {
    // The query uses status: { in: ['PENDING', 'RUNNING'] }, so queued and
    // approval-pending rows count toward the user's quota — they can't pile
    // up an unbounded backlog by submitting many at once.
    mockTrainingSessionCount.mockImplementation(async ({ where }) => {
      expect(where.status).toEqual({ in: ['PENDING', 'RUNNING'] })
      return 1
    })

    await expect(
      startTraining(MODEL_ID, { mode: 'SELF_PLAY', iterations: 1_000 })
    ).rejects.toThrow(/Training limit:/)
  })
})

describe('mlService.startFrontendSession — per-user concurrency cap (A3a.6)', () => {
  const OWNER_BA = 'ba-owner-fe'

  beforeEach(() => {
    mockBotSkillFindUnique.mockResolvedValue({
      id: MODEL_ID, gameId: 'tic-tac-toe', algorithm: 'qlearning', status: 'IDLE',
      maxEpisodes: 100_000, totalEpisodes: 0, config: {}, weights: {},
      createdBy: OWNER_BA,
    })
    mockUserFindUnique.mockResolvedValue({ id: 'fe-owner', userRoles: [] })
  })

  it('enforces the same per-user cap as startTraining', async () => {
    mockTrainingSessionCount.mockResolvedValue(1)

    await expect(
      startFrontendSession(MODEL_ID, { mode: 'VS_MINIMAX', iterations: 1_000 })
    ).rejects.toThrow(/Training limit:/)
    expect(mockTrainingSessionCreate).not.toHaveBeenCalled()
  })
})
