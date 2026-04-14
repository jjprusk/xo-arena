/**
 * MIXED mode tournament tests.
 *
 * Covers:
 * - Both humans and bots can register for a MIXED tournament
 * - Bot-vs-bot pairing in MIXED → enqueueJob called
 * - Human-vs-bot pairing in MIXED → publishEvent('tournament:match:ready') called
 * - Human-vs-human pairing in MIXED → publishEvent('tournament:match:ready') called
 * - completeMatch writes a Game row for human-vs-bot pairing in MIXED mode
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock @xo-arena/db ────────────────────────────────────────────────────────

const mockDb = {
  user: { findUnique: vi.fn() },
  game: { create: vi.fn() },
  systemConfig: { findUnique: vi.fn() },
  tournament: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
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

// ─── Mock classificationService ──────────────────────────────────────────────

vi.mock('../services/classificationService.js', () => ({
  awardTournamentMerits: vi.fn().mockResolvedValue(undefined),
  getOrCreateClassification: vi.fn().mockResolvedValue({}),
}))

// ─── Import service AFTER mocks ───────────────────────────────────────────────

const { registerParticipant, startTournament, completeMatch } =
  await import('../services/tournamentService.js')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMixedTournament(overrides = {}) {
  return {
    id: 'tour_mixed',
    name: 'Mixed Tournament',
    status: 'REGISTRATION_OPEN',
    minParticipants: 2,
    maxParticipants: null,
    bestOfN: 3,
    mode: 'MIXED',
    format: 'PLANNED',
    bracketType: 'SINGLE_ELIM',
    game: 'xo-arena',
    participants: [],
    ...overrides,
  }
}

function makeHumanUser(overrides = {}) {
  return {
    id: 'user_human_1',
    eloRating: 1200,
    isBot: false,
    botActive: false,
    botAvailable: false,
    botProvisional: false,
    botCompetitive: false,
    botGamesPlayed: 0,
    ...overrides,
  }
}

function makeBotUser(overrides = {}) {
  return {
    id: 'user_bot_1',
    eloRating: 1300,
    isBot: true,
    botActive: true,
    botAvailable: true,
    botProvisional: false,
    botCompetitive: true,
    botGamesPlayed: 10,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.game.create.mockResolvedValue({})
})

// ─── Registration eligibility ─────────────────────────────────────────────────

describe('registerParticipant — MIXED mode', () => {
  it('allows a human to register for a MIXED tournament', async () => {
    mockDb.user.findUnique.mockResolvedValue(makeHumanUser())
    mockDb.tournament.findUnique.mockResolvedValue({
      ...makeMixedTournament(),
      _count: { participants: 0 },
    })
    mockDb.tournamentParticipant.findUnique.mockResolvedValue(null)
    mockDb.tournamentParticipant.create.mockResolvedValue({
      id: 'part_1',
      tournamentId: 'tour_mixed',
      userId: 'user_human_1',
      status: 'REGISTERED',
      eloAtRegistration: 1200,
    })

    const result = await registerParticipant('tour_mixed', 'ba_human_1')
    expect(result.status).toBe('REGISTERED')
  })

  it('allows a bot to register for a MIXED tournament', async () => {
    mockDb.user.findUnique.mockResolvedValue(makeBotUser({ betterAuthId: 'ba_bot_1' }))
    mockDb.tournament.findUnique.mockResolvedValue({
      ...makeMixedTournament(),
      _count: { participants: 1 },
    })
    mockDb.tournamentParticipant.findUnique.mockResolvedValue(null)
    mockDb.tournamentParticipant.create.mockResolvedValue({
      id: 'part_2',
      tournamentId: 'tour_mixed',
      userId: 'user_bot_1',
      status: 'REGISTERED',
      eloAtRegistration: 1300,
    })

    const result = await registerParticipant('tour_mixed', 'ba_bot_1')
    expect(result.status).toBe('REGISTERED')
  })
})

// ─── Match dispatch ───────────────────────────────────────────────────────────

describe('startTournament — MIXED mode dispatch', () => {
  function setupStartTournament({ p1IsBot, p2IsBot }) {
    const participants = [
      {
        id: 'part_1',
        userId: 'user_1',
        eloAtRegistration: 1300,
        user: { betterAuthId: 'ba_1', eloRating: 1300, isBot: p1IsBot },
      },
      {
        id: 'part_2',
        userId: 'user_2',
        eloAtRegistration: 1200,
        user: { betterAuthId: 'ba_2', eloRating: 1200, isBot: p2IsBot },
      },
    ]
    const tournament = makeMixedTournament({ participants })

    mockDb.tournament.findUnique.mockResolvedValue(tournament)
    mockDb.tournament.update.mockResolvedValue({ ...tournament, status: 'IN_PROGRESS' })
    mockDb.tournamentRound.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `round_${data.roundNumber}`, ...data })
    )
    mockDb.tournamentMatch.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'match_1', ...data, createdAt: new Date() })
    )
    mockDb.tournamentRound.update.mockResolvedValue({})
    mockDb.tournamentMatch.update.mockResolvedValue({})
    mockDb.tournamentParticipant.update.mockResolvedValue({})

    // _dispatchMatch fetches participants from DB
    mockDb.tournamentParticipant.findUnique
      .mockResolvedValueOnce({
        id: 'part_1',
        userId: 'user_1',
        user: { betterAuthId: 'ba_1', isBot: p1IsBot },
      })
      .mockResolvedValueOnce({
        id: 'part_2',
        userId: 'user_2',
        user: { betterAuthId: 'ba_2', isBot: p2IsBot },
      })
  }

  it('calls enqueueJob for a bot-vs-bot pairing in MIXED mode', async () => {
    setupStartTournament({ p1IsBot: true, p2IsBot: true })

    await startTournament('tour_mixed', 'admin_ba')

    expect(mockEnqueueJob).toHaveBeenCalledWith('match_1', 'tour_mixed')
    expect(mockPublishEvent).not.toHaveBeenCalledWith(
      'tournament:match:ready',
      expect.anything()
    )
  })

  it('calls publishEvent for a human-vs-bot pairing in MIXED mode', async () => {
    setupStartTournament({ p1IsBot: false, p2IsBot: true })

    await startTournament('tour_mixed', 'admin_ba')

    expect(mockPublishEvent).toHaveBeenCalledWith(
      'tournament:match:ready',
      expect.objectContaining({ matchId: 'match_1', tournamentId: 'tour_mixed' })
    )
    expect(mockEnqueueJob).not.toHaveBeenCalled()
  })

  it('calls publishEvent for a human-vs-human pairing in MIXED mode', async () => {
    setupStartTournament({ p1IsBot: false, p2IsBot: false })

    await startTournament('tour_mixed', 'admin_ba')

    expect(mockPublishEvent).toHaveBeenCalledWith(
      'tournament:match:ready',
      expect.objectContaining({ matchId: 'match_1', tournamentId: 'tour_mixed' })
    )
    expect(mockEnqueueJob).not.toHaveBeenCalled()
  })
})

// ─── completeMatch — Game row for human-vs-bot ────────────────────────────────

describe('completeMatch — MIXED mode Game row', () => {
  it('writes a Game row when a human-vs-bot match completes in MIXED mode', async () => {
    const match = {
      id: 'match_hvb',
      tournamentId: 'tour_mixed',
      roundId: 'round_1',
      participant1Id: 'part_human',
      participant2Id: 'part_bot',
      winnerId: null,
      status: 'IN_PROGRESS',
      p1Wins: 0,
      p2Wins: 0,
      drawGames: 0,
      createdAt: new Date('2026-01-01'),
      round: {
        id: 'round_1',
        tournamentId: 'tour_mixed',
        roundNumber: 1,
        tournament: {
          id: 'tour_mixed',
          status: 'IN_PROGRESS',
          mode: 'MIXED',
          bracketType: 'SINGLE_ELIM',
          game: 'xo-arena',
        },
        matches: [],
      },
    }

    mockDb.tournamentMatch.findUnique
      .mockResolvedValueOnce(match) // initial load
      .mockResolvedValueOnce({ ...match, status: 'COMPLETED', winnerId: 'part_human' }) // final fetch

    mockDb.tournamentMatch.update.mockResolvedValue({ ...match, status: 'COMPLETED', winnerId: 'part_human' })

    // participant lookups for Game row creation
    mockDb.tournamentParticipant.findUnique
      .mockResolvedValueOnce({
        id: 'part_human',
        userId: 'user_human_1',
        user: { id: 'user_human_1', isBot: false },
      })
      .mockResolvedValueOnce({
        id: 'part_bot',
        userId: 'user_bot_1',
        user: { id: 'user_bot_1', isBot: true },
      })

    mockDb.tournamentParticipant.update.mockResolvedValue({})
    mockDb.tournamentParticipant.findMany.mockResolvedValue([
      { id: 'part_human', userId: 'user_human_1', user: { betterAuthId: 'ba_human' }, eloAtRegistration: 1200, status: 'ACTIVE' },
      { id: 'part_bot', userId: 'user_bot_1', user: { betterAuthId: 'ba_bot' }, eloAtRegistration: 1300, status: 'ACTIVE' },
    ])
    mockDb.tournamentRound.findMany.mockResolvedValue([{ id: 'round_1', roundNumber: 1 }])
    mockDb.tournamentMatch.findMany.mockResolvedValue([{ ...match, status: 'COMPLETED', winnerId: 'part_human' }])
    mockDb.tournament.update.mockResolvedValue({ id: 'tour_mixed', status: 'COMPLETED' })

    await completeMatch('match_hvb', 'part_human', { p1Wins: 2, p2Wins: 0, drawGames: 0 })

    expect(mockDb.game.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          player1Id: 'user_human_1',
          player2Id: 'user_bot_1',
          mode: 'HVB',
          tournamentId: 'tour_mixed',
          tournamentMatchId: 'match_hvb',
          outcome: 'PLAYER1_WIN',
        }),
      })
    )
  })
})
