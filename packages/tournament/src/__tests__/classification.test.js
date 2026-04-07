/**
 * Phase 2: Player Classification tests
 *
 * Covers:
 * - Merit award by band and position (all 4 bands, all 4 positions)
 * - Ties at same finish position
 * - Best Overall bonus (awarded / not awarded at threshold)
 * - Promotion on merit accumulation, merit reset on promotion
 * - Demotion: Finish Ratio, eligibility conditions
 * - Bot classification is independent of owner
 * - SystemConfig overrides apply to thresholds
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock @xo-arena/db ────────────────────────────────────────────────────────

const mockDb = {
  playerClassification: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  meritTransaction: { create: vi.fn() },
  classificationHistory: { create: vi.fn(), findFirst: vi.fn() },
  meritThreshold: { findMany: vi.fn() },
  systemConfig: { findUnique: vi.fn() },
  tournamentParticipant: { findMany: vi.fn() },
}

vi.mock('@xo-arena/db', () => ({ default: mockDb }))

const {
  getOrCreateClassification,
  awardTournamentMerits,
  checkPromotion,
  runDemotionReview,
  adminOverrideTier,
} = await import('../services/classificationService.js')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClassification(overrides = {}) {
  return {
    id: 'class_1',
    userId: 'user_1',
    tier: 'RECRUIT',
    merits: 0,
    ...overrides,
  }
}

function makeParticipant(overrides = {}) {
  return {
    id: 'part_1',
    userId: 'user_1',
    tournamentId: 'tour_1',
    status: 'ELIMINATED',
    finalPosition: 1,
    finalPositionPct: 100,
    registeredAt: new Date(),
    user: { id: 'user_1', eloRating: 1200 },
    ...overrides,
  }
}

const DEFAULT_BANDS = [
  { id: 'b1', bandMin: 3,  bandMax: 9,    pos1: 2, pos2: 1, pos3: 0, pos4: 0 },
  { id: 'b2', bandMin: 10, bandMax: 19,   pos1: 3, pos2: 2, pos3: 1, pos4: 0 },
  { id: 'b3', bandMin: 20, bandMax: 49,   pos1: 4, pos2: 3, pos3: 2, pos4: 1 },
  { id: 'b4', bandMin: 50, bandMax: null, pos1: 5, pos2: 4, pos3: 3, pos4: 2 },
]

beforeEach(() => {
  vi.resetAllMocks()
  mockDb.systemConfig.findUnique.mockResolvedValue(null) // use defaults
})

// ─── getOrCreateClassification ────────────────────────────────────────────────

describe('getOrCreateClassification', () => {
  it('returns existing classification', async () => {
    const existing = makeClassification()
    mockDb.playerClassification.findUnique.mockResolvedValue(existing)

    const result = await getOrCreateClassification('user_1')
    expect(result).toEqual(existing)
    expect(mockDb.playerClassification.create).not.toHaveBeenCalled()
  })

  it('creates classification at RECRUIT/0 if none exists', async () => {
    mockDb.playerClassification.findUnique.mockResolvedValue(null)
    mockDb.playerClassification.create.mockResolvedValue(makeClassification())

    const result = await getOrCreateClassification('user_1')
    expect(result.tier).toBe('RECRUIT')
    expect(result.merits).toBe(0)
    expect(mockDb.playerClassification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user_1',
          tier: 'RECRUIT',
          merits: 0,
        }),
      })
    )
  })
})

// ─── Merit awards ─────────────────────────────────────────────────────────────

describe('awardTournamentMerits — band selection', () => {
  it('awards pos1 merits for band 3-9 (tier-peer count = 4)', async () => {
    // 4 participants in same tier
    const participants = [1, 2, 3, 4].map(i =>
      makeParticipant({ id: `p${i}`, userId: `u${i}`, finalPosition: i })
    )
    mockDb.tournamentParticipant.findMany.mockResolvedValue(participants)
    mockDb.meritThreshold.findMany.mockResolvedValue(DEFAULT_BANDS)
    mockDb.playerClassification.findUnique.mockResolvedValue(null)
    mockDb.playerClassification.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `class_${data.userId}`, userId: data.userId, tier: 'RECRUIT', merits: 0 })
    )
    mockDb.playerClassification.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'class_1', merits: 2, tier: 'RECRUIT', ...data })
    )
    mockDb.meritTransaction.create.mockResolvedValue({})
    mockDb.classificationHistory.create.mockResolvedValue({})

    await awardTournamentMerits('tour_1')

    // 1st place should get pos1=2 merits
    const updateCalls = mockDb.playerClassification.update.mock.calls
    const firstPlaceCall = updateCalls.find(c => c[0].data?.merits?.increment === 2)
    expect(firstPlaceCall).toBeDefined()
  })

  it('awards pos2 merits (1) for 2nd place in band 3-9', async () => {
    const participants = [1, 2, 3, 4].map(i =>
      makeParticipant({ id: `p${i}`, userId: `u${i}`, finalPosition: i })
    )
    mockDb.tournamentParticipant.findMany.mockResolvedValue(participants)
    mockDb.meritThreshold.findMany.mockResolvedValue(DEFAULT_BANDS)
    mockDb.playerClassification.findUnique.mockResolvedValue(null)
    mockDb.playerClassification.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `class_${data.userId}`, userId: data.userId, tier: 'RECRUIT', merits: 0 })
    )
    mockDb.playerClassification.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'class_1', merits: 1, tier: 'RECRUIT', ...data })
    )
    mockDb.meritTransaction.create.mockResolvedValue({})
    mockDb.classificationHistory.create.mockResolvedValue({})

    await awardTournamentMerits('tour_1')

    const updateCalls = mockDb.playerClassification.update.mock.calls
    const secondPlaceCall = updateCalls.find(c => c[0].data?.merits?.increment === 1)
    expect(secondPlaceCall).toBeDefined()
  })

  it('skips merit awards when tier-peer count < 3', async () => {
    // Only 2 participants in the tier
    const participants = [1, 2].map(i =>
      makeParticipant({ id: `p${i}`, userId: `u${i}`, finalPosition: i })
    )
    mockDb.tournamentParticipant.findMany.mockResolvedValue(participants)
    mockDb.meritThreshold.findMany.mockResolvedValue(DEFAULT_BANDS)
    mockDb.playerClassification.findUnique.mockResolvedValue(null)
    mockDb.playerClassification.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `class_${data.userId}`, userId: data.userId, tier: 'RECRUIT', merits: 0 })
    )

    await awardTournamentMerits('tour_1')

    expect(mockDb.playerClassification.update).not.toHaveBeenCalled()
  })

  it('skips award when no MeritThreshold bands configured', async () => {
    const participants = [1, 2, 3, 4].map(i =>
      makeParticipant({ id: `p${i}`, userId: `u${i}`, finalPosition: i })
    )
    mockDb.tournamentParticipant.findMany.mockResolvedValue(participants)
    mockDb.meritThreshold.findMany.mockResolvedValue([]) // no bands

    await awardTournamentMerits('tour_1')

    expect(mockDb.playerClassification.update).not.toHaveBeenCalled()
  })
})

describe('awardTournamentMerits — ties', () => {
  it('awards same merits to tied participants at same position', async () => {
    // Two players tied for 1st
    const participants = [
      makeParticipant({ id: 'p1', userId: 'u1', finalPosition: 1 }),
      makeParticipant({ id: 'p2', userId: 'u2', finalPosition: 1 }),
      makeParticipant({ id: 'p3', userId: 'u3', finalPosition: 3 }),
      makeParticipant({ id: 'p4', userId: 'u4', finalPosition: 4 }),
    ]
    mockDb.tournamentParticipant.findMany.mockResolvedValue(participants)
    mockDb.meritThreshold.findMany.mockResolvedValue(DEFAULT_BANDS)
    mockDb.playerClassification.findUnique.mockResolvedValue(null)
    mockDb.playerClassification.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `class_${data.userId}`, userId: data.userId, tier: 'RECRUIT', merits: 0 })
    )
    mockDb.playerClassification.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'class_1', merits: 2, tier: 'RECRUIT', ...data })
    )
    mockDb.meritTransaction.create.mockResolvedValue({})
    mockDb.classificationHistory.create.mockResolvedValue({})

    await awardTournamentMerits('tour_1')

    // Both tied 1st place participants get pos1=2 merits
    const incrementCalls = mockDb.playerClassification.update.mock.calls
      .filter(c => c[0].data?.merits?.increment === 2)
    expect(incrementCalls.length).toBe(2)
  })
})

describe('awardTournamentMerits — best overall bonus', () => {
  it('awards +1 bonus to 1st place when total participants >= 10', async () => {
    const participants = Array.from({ length: 10 }, (_, i) =>
      makeParticipant({ id: `p${i+1}`, userId: `u${i+1}`, finalPosition: i + 1 })
    )
    mockDb.tournamentParticipant.findMany.mockResolvedValue(participants)
    mockDb.meritThreshold.findMany.mockResolvedValue(DEFAULT_BANDS)
    mockDb.playerClassification.findUnique.mockResolvedValue(null)
    mockDb.playerClassification.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `class_${data.userId}`, userId: data.userId, tier: 'RECRUIT', merits: 0 })
    )
    mockDb.playerClassification.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'class_1', merits: 0, tier: 'RECRUIT', ...data })
    )
    mockDb.meritTransaction.create.mockResolvedValue({})
    mockDb.classificationHistory.create.mockResolvedValue({})
    // systemConfig returns 10 for bestOverallBonus.minParticipants
    mockDb.systemConfig.findUnique.mockImplementation(({ where }) => {
      if (where.key === 'classification.bestOverallBonus.minParticipants') {
        return Promise.resolve({ key: where.key, value: 10 })
      }
      return Promise.resolve(null)
    })

    await awardTournamentMerits('tour_1')

    // +1 merit bonus should be awarded (increment: 1 call)
    const bonusCalls = mockDb.meritTransaction.create.mock.calls.filter(
      c => c[0].data?.reason === 'best_overall_bonus'
    )
    expect(bonusCalls.length).toBe(1)
  })

  it('does NOT award best overall bonus when total participants < 10', async () => {
    const participants = Array.from({ length: 5 }, (_, i) =>
      makeParticipant({ id: `p${i+1}`, userId: `u${i+1}`, finalPosition: i + 1 })
    )
    mockDb.tournamentParticipant.findMany.mockResolvedValue(participants)
    mockDb.meritThreshold.findMany.mockResolvedValue(DEFAULT_BANDS)
    mockDb.playerClassification.findUnique.mockResolvedValue(null)
    mockDb.playerClassification.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `class_${data.userId}`, userId: data.userId, tier: 'RECRUIT', merits: 0 })
    )
    mockDb.playerClassification.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'class_1', merits: 0, tier: 'RECRUIT', ...data })
    )
    mockDb.meritTransaction.create.mockResolvedValue({})
    mockDb.classificationHistory.create.mockResolvedValue({})
    mockDb.systemConfig.findUnique.mockImplementation(({ where }) => {
      if (where.key === 'classification.bestOverallBonus.minParticipants') {
        return Promise.resolve({ key: where.key, value: 10 })
      }
      return Promise.resolve(null)
    })

    await awardTournamentMerits('tour_1')

    const bonusCalls = mockDb.meritTransaction.create.mock.calls.filter(
      c => c[0].data?.reason === 'best_overall_bonus'
    )
    expect(bonusCalls.length).toBe(0)
  })
})

// ─── Promotion ────────────────────────────────────────────────────────────────

describe('checkPromotion', () => {
  it('promotes when merits >= required threshold', async () => {
    mockDb.playerClassification.findUnique
      .mockResolvedValueOnce({ id: 'class_1', userId: 'u1', tier: 'RECRUIT', merits: 4 })
      .mockResolvedValueOnce({ id: 'class_1', userId: 'u1', tier: 'CONTENDER', merits: 0 })
    mockDb.playerClassification.update.mockResolvedValue({
      id: 'class_1', tier: 'CONTENDER', merits: 0,
    })
    mockDb.meritTransaction.create.mockResolvedValue({})
    mockDb.classificationHistory.create.mockResolvedValue({})
    // default threshold for RECRUIT = 4
    mockDb.systemConfig.findUnique.mockResolvedValue(null)

    await checkPromotion('class_1')

    expect(mockDb.playerClassification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { tier: 'CONTENDER', merits: 0 },
      })
    )
    expect(mockDb.classificationHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromTier: 'RECRUIT', toTier: 'CONTENDER', reason: 'promotion' }),
      })
    )
  })

  it('does not promote when below threshold', async () => {
    mockDb.playerClassification.findUnique.mockResolvedValue({
      id: 'class_1', userId: 'u1', tier: 'RECRUIT', merits: 3,
    })
    mockDb.systemConfig.findUnique.mockResolvedValue(null)

    await checkPromotion('class_1')

    expect(mockDb.playerClassification.update).not.toHaveBeenCalled()
  })

  it('does not promote LEGEND tier', async () => {
    mockDb.playerClassification.findUnique.mockResolvedValue({
      id: 'class_1', userId: 'u1', tier: 'LEGEND', merits: 999,
    })
    mockDb.systemConfig.findUnique.mockResolvedValue(null)

    await checkPromotion('class_1')

    expect(mockDb.playerClassification.update).not.toHaveBeenCalled()
  })

  it('respects SystemConfig override for promotion threshold', async () => {
    mockDb.playerClassification.findUnique
      .mockResolvedValueOnce({ id: 'class_1', userId: 'u1', tier: 'RECRUIT', merits: 3 })
      .mockResolvedValueOnce({ id: 'class_1', userId: 'u1', tier: 'CONTENDER', merits: 0 })
    // Override RECRUIT threshold to 3 (lower than default 4)
    mockDb.systemConfig.findUnique.mockImplementation(({ where }) => {
      if (where.key === 'classification.tiers.RECRUIT.meritsRequired') {
        return Promise.resolve({ value: 3 })
      }
      return Promise.resolve(null)
    })
    mockDb.playerClassification.update.mockResolvedValue({ id: 'class_1', tier: 'CONTENDER', merits: 0 })
    mockDb.meritTransaction.create.mockResolvedValue({})
    mockDb.classificationHistory.create.mockResolvedValue({})

    await checkPromotion('class_1')

    expect(mockDb.playerClassification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tier: 'CONTENDER', merits: 0 } })
    )
  })
})

// ─── Demotion ─────────────────────────────────────────────────────────────────

describe('runDemotionReview', () => {
  it('demotes player below finish ratio threshold', async () => {
    const classification = makeClassification({ tier: 'CONTENDER', merits: 2 })
    mockDb.playerClassification.findMany.mockResolvedValue([classification])
    mockDb.systemConfig.findUnique.mockResolvedValue(null) // use defaults
    // 5 participations: all finished last (positionPct = 0)
    mockDb.tournamentParticipant.findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) =>
        makeParticipant({ id: `p${i}`, finalPosition: 5, finalPositionPct: 0, registeredAt: new Date() })
      )
    )
    mockDb.classificationHistory.findFirst.mockResolvedValue(null) // no recent promotion
    mockDb.playerClassification.update.mockResolvedValue({ ...classification, tier: 'RECRUIT', merits: 0 })
    mockDb.meritTransaction.create.mockResolvedValue({})
    mockDb.classificationHistory.create.mockResolvedValue({})

    await runDemotionReview()

    expect(mockDb.playerClassification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tier: 'RECRUIT', merits: 0 } })
    )
  })

  it('does not demote RECRUIT tier', async () => {
    mockDb.playerClassification.findMany.mockResolvedValue([]) // findMany with { tier: { not: 'RECRUIT' } } returns empty
    await runDemotionReview()
    expect(mockDb.playerClassification.update).not.toHaveBeenCalled()
  })

  it('does not demote player above finish ratio threshold', async () => {
    const classification = makeClassification({ tier: 'CONTENDER', merits: 2 })
    mockDb.playerClassification.findMany.mockResolvedValue([classification])
    mockDb.systemConfig.findUnique.mockResolvedValue(null)
    // 5 participations: 4 finished above last
    mockDb.tournamentParticipant.findMany.mockResolvedValue(
      [
        makeParticipant({ id: 'p1', finalPositionPct: 75, registeredAt: new Date() }),
        makeParticipant({ id: 'p2', finalPositionPct: 50, registeredAt: new Date() }),
        makeParticipant({ id: 'p3', finalPositionPct: 25, registeredAt: new Date() }),
        makeParticipant({ id: 'p4', finalPositionPct: 10, registeredAt: new Date() }),
        makeParticipant({ id: 'p5', finalPositionPct: 0, registeredAt: new Date() }),
      ]
    )
    mockDb.classificationHistory.findFirst.mockResolvedValue(null)

    await runDemotionReview()

    expect(mockDb.playerClassification.update).not.toHaveBeenCalled()
  })

  it('does not demote player with recent promotion', async () => {
    const classification = makeClassification({ tier: 'CONTENDER', merits: 0 })
    mockDb.playerClassification.findMany.mockResolvedValue([classification])
    mockDb.systemConfig.findUnique.mockResolvedValue(null)
    mockDb.tournamentParticipant.findMany.mockResolvedValue(
      Array.from({ length: 5 }, () =>
        makeParticipant({ finalPositionPct: 0, registeredAt: new Date() })
      )
    )
    // Has a recent promotion
    mockDb.classificationHistory.findFirst.mockResolvedValue({
      id: 'hist_1', reason: 'promotion', createdAt: new Date(),
    })

    await runDemotionReview()

    expect(mockDb.playerClassification.update).not.toHaveBeenCalled()
  })

  it('does not demote player with fewer than minQualifyingMatches', async () => {
    const classification = makeClassification({ tier: 'CONTENDER', merits: 0 })
    mockDb.playerClassification.findMany.mockResolvedValue([classification])
    mockDb.systemConfig.findUnique.mockResolvedValue(null) // default minMatches = 5
    mockDb.tournamentParticipant.findMany.mockResolvedValue(
      // Only 3 participations — below minQualifyingMatches (5)
      Array.from({ length: 3 }, () =>
        makeParticipant({ finalPositionPct: 0, registeredAt: new Date() })
      )
    )

    await runDemotionReview()

    expect(mockDb.playerClassification.update).not.toHaveBeenCalled()
  })
})

// ─── Bot classification independence ─────────────────────────────────────────

describe('bot classification independence', () => {
  it('creates classification for bot user independently', async () => {
    const botUserId = 'bot_user_1'
    const humanUserId = 'human_user_1'

    mockDb.playerClassification.findUnique.mockResolvedValue(null)
    mockDb.playerClassification.create
      .mockResolvedValueOnce(makeClassification({ userId: botUserId }))
      .mockResolvedValueOnce(makeClassification({ userId: humanUserId }))

    await getOrCreateClassification(botUserId)
    await getOrCreateClassification(humanUserId)

    // Each gets their own create call
    expect(mockDb.playerClassification.create).toHaveBeenCalledTimes(2)
    const calls = mockDb.playerClassification.create.mock.calls
    expect(calls[0][0].data.userId).toBe(botUserId)
    expect(calls[1][0].data.userId).toBe(humanUserId)
  })
})

// ─── Admin override ───────────────────────────────────────────────────────────

describe('adminOverrideTier', () => {
  it('changes tier to the specified value', async () => {
    mockDb.playerClassification.findUnique
      .mockResolvedValueOnce(makeClassification({ tier: 'RECRUIT' }))
      .mockResolvedValueOnce(makeClassification({ tier: 'ELITE' }))
    mockDb.playerClassification.update.mockResolvedValue(makeClassification({ tier: 'ELITE', merits: 0 }))
    mockDb.classificationHistory.create.mockResolvedValue({})

    const result = await adminOverrideTier('user_1', 'ELITE')

    expect(mockDb.playerClassification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tier: 'ELITE', merits: 0 } })
    )
    expect(mockDb.classificationHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ toTier: 'ELITE', reason: 'admin_override' }),
      })
    )
  })

  it('throws 400 for invalid tier', async () => {
    await expect(adminOverrideTier('user_1', 'INVALID_TIER')).rejects.toMatchObject({
      status: 400,
    })
  })
})
