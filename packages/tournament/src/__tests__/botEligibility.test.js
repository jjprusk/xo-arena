/**
 * Bot eligibility tests for registerParticipant.
 *
 * Covers:
 * - BOT_VS_BOT tournaments enforce bot-specific eligibility requirements
 * - PVP tournaments do not apply bot eligibility checks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock @xo-arena/db ────────────────────────────────────────────────────────

const mockDb = {
  user: { findUnique: vi.fn() },
  tournament: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  systemConfig: { findUnique: vi.fn() },
  tournamentParticipant: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
  tournamentRound: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  tournamentMatch: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
}

vi.mock('@xo-arena/db', () => ({ default: mockDb }))

// ─── Mock Redis ───────────────────────────────────────────────────────────────

const mockPublishEvent = vi.fn().mockResolvedValue(undefined)
vi.mock('../lib/redis.js', () => ({ publishEvent: mockPublishEvent }))

// ─── Mock botJobQueue ─────────────────────────────────────────────────────────

const mockEnqueueJob = vi.fn().mockResolvedValue(undefined)
vi.mock('../lib/botJobQueue.js', () => ({
  enqueueJob: mockEnqueueJob,
  dequeueJob: vi.fn(),
  acknowledgeJob: vi.fn(),
  getActiveCount: vi.fn(),
  getQueueDepth: vi.fn(),
  getActiveJobs: vi.fn(),
  reconcileOrphans: vi.fn(),
}))

// ─── Import service AFTER mocks ───────────────────────────────────────────────

const { registerParticipant } = await import('../services/tournamentService.js')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBotUser(overrides = {}) {
  return {
    id: 'user_bot_1',
    eloRating: 1200,
    isBot: true,
    botActive: true,
    botAvailable: true,
    botProvisional: false,
    botCompetitive: true,
    botGamesPlayed: 20,
    ...overrides,
  }
}

function makeBvbTournament(overrides = {}) {
  return {
    id: 'tour_bvb_1',
    name: 'Bot vs Bot Tournament',
    status: 'REGISTRATION_OPEN',
    mode: 'BOT_VS_BOT',
    minParticipants: 4,
    maxParticipants: null,
    bestOfN: 3,
    botMinGamesPlayed: null,
    allowNonCompetitiveBots: false,
    _count: { participants: 2 },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: systemConfig returns null (no global config)
  mockDb.systemConfig.findUnique.mockResolvedValue(null)
})

// ─── Bot eligibility for BOT_VS_BOT tournaments ───────────────────────────────

describe('registerParticipant — BOT_VS_BOT eligibility', () => {
  it('rejects non-bot users in BOT_VS_BOT tournament', async () => {
    mockDb.user.findUnique.mockResolvedValue(makeBotUser({ isBot: false }))
    mockDb.tournament.findUnique.mockResolvedValue(makeBvbTournament())

    await expect(registerParticipant('tour_bvb_1', 'ba_1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Only bots'),
    })
  })

  it('rejects inactive bot', async () => {
    mockDb.user.findUnique.mockResolvedValue(makeBotUser({ botActive: false }))
    mockDb.tournament.findUnique.mockResolvedValue(makeBvbTournament())

    await expect(registerParticipant('tour_bvb_1', 'ba_1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('not active'),
    })
  })

  it('rejects unavailable bot', async () => {
    mockDb.user.findUnique.mockResolvedValue(makeBotUser({ botAvailable: false }))
    mockDb.tournament.findUnique.mockResolvedValue(makeBvbTournament())

    await expect(registerParticipant('tour_bvb_1', 'ba_1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('not available'),
    })
  })

  it('rejects provisional bot', async () => {
    mockDb.user.findUnique.mockResolvedValue(makeBotUser({ botProvisional: true }))
    mockDb.tournament.findUnique.mockResolvedValue(makeBvbTournament())

    await expect(registerParticipant('tour_bvb_1', 'ba_1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Provisional'),
    })
  })

  it('rejects bot with insufficient games played (tournament.botMinGamesPlayed set)', async () => {
    mockDb.user.findUnique.mockResolvedValue(makeBotUser({ botGamesPlayed: 5 }))
    mockDb.tournament.findUnique.mockResolvedValue(makeBvbTournament({ botMinGamesPlayed: 10 }))

    await expect(registerParticipant('tour_bvb_1', 'ba_1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('insufficient games played'),
    })
  })

  it('rejects non-competitive bot when allowNonCompetitiveBots=false', async () => {
    mockDb.user.findUnique.mockResolvedValue(makeBotUser({ botCompetitive: false }))
    mockDb.tournament.findUnique.mockResolvedValue(
      makeBvbTournament({ allowNonCompetitiveBots: false })
    )

    await expect(registerParticipant('tour_bvb_1', 'ba_1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Non-competitive'),
    })
  })

  it('allows non-competitive bot when allowNonCompetitiveBots=true', async () => {
    mockDb.user.findUnique.mockResolvedValue(makeBotUser({ botCompetitive: false }))
    mockDb.tournament.findUnique.mockResolvedValue(
      makeBvbTournament({ allowNonCompetitiveBots: true })
    )
    mockDb.tournamentParticipant.findUnique.mockResolvedValue(null)
    mockDb.tournamentParticipant.create.mockResolvedValue({
      id: 'part_1',
      tournamentId: 'tour_bvb_1',
      userId: 'user_bot_1',
      status: 'REGISTERED',
    })

    const result = await registerParticipant('tour_bvb_1', 'ba_1')
    expect(result.status).toBe('REGISTERED')
  })

  it('allows eligible bot in BOT_VS_BOT tournament', async () => {
    mockDb.user.findUnique.mockResolvedValue(makeBotUser())
    mockDb.tournament.findUnique.mockResolvedValue(makeBvbTournament())
    mockDb.tournamentParticipant.findUnique.mockResolvedValue(null)
    mockDb.tournamentParticipant.create.mockResolvedValue({
      id: 'part_1',
      tournamentId: 'tour_bvb_1',
      userId: 'user_bot_1',
      status: 'REGISTERED',
    })

    const result = await registerParticipant('tour_bvb_1', 'ba_1')
    expect(result.status).toBe('REGISTERED')
  })

  it('uses systemConfig minGamesPlayed when tournament.botMinGamesPlayed is null', async () => {
    // Bot has only 3 games, system config requires 5
    mockDb.user.findUnique.mockResolvedValue(makeBotUser({ botGamesPlayed: 3 }))
    mockDb.tournament.findUnique.mockResolvedValue(
      makeBvbTournament({ botMinGamesPlayed: null })
    )
    // Simulate systemConfig returning minGamesPlayed = 5
    mockDb.systemConfig.findUnique.mockResolvedValue({ key: 'tournament.botMatch.minGamesPlayed', value: 5 })

    await expect(registerParticipant('tour_bvb_1', 'ba_1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('insufficient games played'),
    })
  })

  it('does not check bot eligibility for PVP tournament', async () => {
    // Non-bot user registering for PVP — should succeed
    mockDb.user.findUnique.mockResolvedValue({
      id: 'user_human_1',
      eloRating: 1200,
      isBot: false,
      botActive: false,
      botAvailable: false,
      botProvisional: false,
      botCompetitive: false,
      botGamesPlayed: 0,
    })
    mockDb.tournament.findUnique.mockResolvedValue({
      id: 'tour_pvp_1',
      name: 'PVP Tournament',
      status: 'REGISTRATION_OPEN',
      mode: 'PVP',
      minParticipants: 4,
      maxParticipants: null,
      bestOfN: 3,
      botMinGamesPlayed: null,
      allowNonCompetitiveBots: false,
      _count: { participants: 1 },
    })
    mockDb.tournamentParticipant.findUnique.mockResolvedValue(null)
    mockDb.tournamentParticipant.create.mockResolvedValue({
      id: 'part_pvp_1',
      tournamentId: 'tour_pvp_1',
      userId: 'user_human_1',
      status: 'REGISTERED',
    })

    const result = await registerParticipant('tour_pvp_1', 'ba_human_1')
    expect(result.status).toBe('REGISTERED')
  })
})
