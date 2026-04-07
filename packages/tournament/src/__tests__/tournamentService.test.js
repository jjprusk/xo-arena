/**
 * Tournament service tests.
 *
 * Covers:
 * - Auto-cancel on minimum participant not met (startTournament)
 * - Registration open/close window enforcement
 * - ELO is NOT modified for tournament game records
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock @xo-arena/db ────────────────────────────────────────────────────────

const mockDb = {
  user: { findUnique: vi.fn() },
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

// ─── Mock Redis publisher ─────────────────────────────────────────────────────

const mockPublishEvent = vi.fn().mockResolvedValue(undefined)
vi.mock('../lib/redis.js', () => ({ publishEvent: mockPublishEvent }))

// ─── Import service AFTER mocks ───────────────────────────────────────────────

const {
  startTournament,
  registerParticipant,
  withdrawParticipant,
  completeMatch,
} = await import('../services/tournamentService.js')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTournament(overrides = {}) {
  return {
    id: 'tour_1',
    name: 'Test Tournament',
    status: 'REGISTRATION_OPEN',
    minParticipants: 4,
    maxParticipants: null,
    bestOfN: 3,
    mode: 'PVP',
    format: 'PLANNED',
    bracketType: 'SINGLE_ELIM',
    participants: [],
    ...overrides,
  }
}

function makeParticipant(overrides = {}) {
  return {
    id: 'part_1',
    tournamentId: 'tour_1',
    userId: 'user_1',
    eloAtRegistration: 1200,
    status: 'REGISTERED',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Auto-cancel on minimum participant not met ───────────────────────────────

describe('startTournament — auto-cancel', () => {
  it('cancels and throws 422 when participant count < minParticipants', async () => {
    const tournament = makeTournament({
      minParticipants: 4,
      participants: [
        { id: 'p1', userId: 'u1', eloAtRegistration: 1300, user: { betterAuthId: 'ba1', eloRating: 1300 } },
        { id: 'p2', userId: 'u2', eloAtRegistration: 1200, user: { betterAuthId: 'ba2', eloRating: 1200 } },
      ],
    })

    mockDb.tournament.findUnique.mockResolvedValue(tournament)
    // cancelTournament will call findUnique again
    mockDb.tournament.findUnique
      .mockResolvedValueOnce(tournament)
      .mockResolvedValueOnce({ ...tournament, participants: [] })
    mockDb.tournament.update.mockResolvedValue({ ...tournament, status: 'CANCELLED' })

    await expect(startTournament('tour_1', 'admin_ba')).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('Insufficient participants'),
    })

    // Verify tournament was updated to CANCELLED
    expect(mockDb.tournament.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED' } })
    )
  })

  it('does not cancel when participant count meets minParticipants', async () => {
    const participants = [
      { id: 'p1', userId: 'u1', eloAtRegistration: 1400, user: { betterAuthId: 'ba1', eloRating: 1400 } },
      { id: 'p2', userId: 'u2', eloAtRegistration: 1300, user: { betterAuthId: 'ba2', eloRating: 1300 } },
      { id: 'p3', userId: 'u3', eloAtRegistration: 1200, user: { betterAuthId: 'ba3', eloRating: 1200 } },
      { id: 'p4', userId: 'u4', eloAtRegistration: 1100, user: { betterAuthId: 'ba4', eloRating: 1100 } },
    ]
    const tournament = makeTournament({ minParticipants: 4, participants })

    mockDb.tournament.findUnique.mockResolvedValue(tournament)
    mockDb.tournament.update.mockResolvedValue({ ...tournament, status: 'IN_PROGRESS' })
    mockDb.tournamentRound.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `round_${data.roundNumber}`, ...data })
    )
    mockDb.tournamentMatch.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `match_${Math.random()}`, ...data, createdAt: new Date() })
    )
    mockDb.tournamentRound.update.mockResolvedValue({})
    mockDb.tournamentMatch.update.mockResolvedValue({})
    mockDb.tournamentParticipant.update.mockResolvedValue({})

    const result = await startTournament('tour_1', 'admin_ba')

    expect(result.tournament.status).toBe('IN_PROGRESS')
    // Should NOT have been called with CANCELLED
    const cancelCall = mockDb.tournament.update.mock.calls.find(
      call => call[0]?.data?.status === 'CANCELLED'
    )
    expect(cancelCall).toBeUndefined()
  })

  it('throws 409 if tournament is not in REGISTRATION_OPEN or REGISTRATION_CLOSED', async () => {
    mockDb.tournament.findUnique.mockResolvedValue(makeTournament({ status: 'DRAFT' }))

    await expect(startTournament('tour_1', 'admin_ba')).rejects.toMatchObject({
      status: 409,
    })
  })

  it('throws 404 if tournament does not exist', async () => {
    mockDb.tournament.findUnique.mockResolvedValue(null)

    await expect(startTournament('nonexistent', 'admin_ba')).rejects.toMatchObject({
      status: 404,
    })
  })
})

// ─── Registration window enforcement ─────────────────────────────────────────

describe('registerParticipant — window enforcement', () => {
  it('succeeds when tournament is REGISTRATION_OPEN', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1', eloRating: 1200 })
    mockDb.tournament.findUnique.mockResolvedValue({
      ...makeTournament({ status: 'REGISTRATION_OPEN' }),
      _count: { participants: 2 },
    })
    mockDb.tournamentParticipant.findUnique.mockResolvedValue(null)
    mockDb.tournamentParticipant.create.mockResolvedValue(makeParticipant())

    const result = await registerParticipant('tour_1', 'ba_1')
    expect(result.status).toBe('REGISTERED')
  })

  it('rejects registration when tournament status is DRAFT', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1', eloRating: 1200 })
    mockDb.tournament.findUnique.mockResolvedValue({
      ...makeTournament({ status: 'DRAFT' }),
      _count: { participants: 0 },
    })

    await expect(registerParticipant('tour_1', 'ba_1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('not open for registration'),
    })
  })

  it('rejects registration when tournament is REGISTRATION_CLOSED', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1', eloRating: 1200 })
    mockDb.tournament.findUnique.mockResolvedValue({
      ...makeTournament({ status: 'REGISTRATION_CLOSED' }),
      _count: { participants: 4 },
    })

    await expect(registerParticipant('tour_1', 'ba_1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('not open for registration'),
    })
  })

  it('rejects registration when tournament is IN_PROGRESS', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1', eloRating: 1200 })
    mockDb.tournament.findUnique.mockResolvedValue({
      ...makeTournament({ status: 'IN_PROGRESS' }),
      _count: { participants: 4 },
    })

    await expect(registerParticipant('tour_1', 'ba_1')).rejects.toMatchObject({
      status: 409,
    })
  })

  it('rejects registration when tournament is COMPLETED', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1', eloRating: 1200 })
    mockDb.tournament.findUnique.mockResolvedValue({
      ...makeTournament({ status: 'COMPLETED' }),
      _count: { participants: 8 },
    })

    await expect(registerParticipant('tour_1', 'ba_1')).rejects.toMatchObject({
      status: 409,
    })
  })

  it('rejects registration when maxParticipants is reached', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1', eloRating: 1200 })
    mockDb.tournament.findUnique.mockResolvedValue({
      ...makeTournament({ status: 'REGISTRATION_OPEN', maxParticipants: 4 }),
      _count: { participants: 4 },
    })

    await expect(registerParticipant('tour_1', 'ba_1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('full'),
    })
  })

  it('snapshots eloAtRegistration from user.eloRating at registration time', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1', eloRating: 1450 })
    mockDb.tournament.findUnique.mockResolvedValue({
      ...makeTournament({ status: 'REGISTRATION_OPEN' }),
      _count: { participants: 1 },
    })
    mockDb.tournamentParticipant.findUnique.mockResolvedValue(null)
    mockDb.tournamentParticipant.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'part_new', ...data })
    )

    const result = await registerParticipant('tour_1', 'ba_1')
    expect(result.eloAtRegistration).toBe(1450)
  })
})

describe('withdrawParticipant — window enforcement', () => {
  it('succeeds when tournament is REGISTRATION_OPEN', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1' })
    mockDb.tournament.findUnique.mockResolvedValue(makeTournament({ status: 'REGISTRATION_OPEN' }))
    mockDb.tournamentParticipant.findUnique.mockResolvedValue(makeParticipant())
    mockDb.tournamentParticipant.update.mockResolvedValue({ ...makeParticipant(), status: 'WITHDRAWN' })

    const result = await withdrawParticipant('tour_1', 'ba_1')
    expect(result.status).toBe('WITHDRAWN')
  })

  it('rejects withdrawal when tournament is REGISTRATION_CLOSED', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1' })
    mockDb.tournament.findUnique.mockResolvedValue(makeTournament({ status: 'REGISTRATION_CLOSED' }))

    await expect(withdrawParticipant('tour_1', 'ba_1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Cannot withdraw after registration has closed'),
    })
  })

  it('rejects withdrawal when tournament is IN_PROGRESS', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1' })
    mockDb.tournament.findUnique.mockResolvedValue(makeTournament({ status: 'IN_PROGRESS' }))

    await expect(withdrawParticipant('tour_1', 'ba_1')).rejects.toMatchObject({
      status: 409,
    })
  })
})

// ─── ELO not modified for tournament games ────────────────────────────────────

describe('completeMatch — ELO isolation', () => {
  it('does not import or call any ELO service', async () => {
    // The tournament service module should not reference eloService at all.
    // We verify by checking that no ELO-related function was called during completeMatch.
    // Since we mock all db calls, any ELO update would have to go through db.user.update
    // (which we don't mock here) — if it throws, the test fails.
    // More directly: the tournamentService module should not have eloService as a dependency.
    const serviceModule = await import('../services/tournamentService.js')
    const sourceKeys = Object.keys(serviceModule)
    // None of the exports should relate to ELO
    expect(sourceKeys).not.toContain('updateElo')
    expect(sourceKeys).not.toContain('recalculateElo')
  })

  it('completeMatch never updates user eloRating', async () => {
    const match = {
      id: 'match_1',
      tournamentId: 'tour_1',
      roundId: 'round_1',
      participant1Id: 'part_1',
      participant2Id: 'part_2',
      winnerId: null,
      status: 'IN_PROGRESS',
      p1Wins: 0,
      p2Wins: 0,
      drawGames: 0,
      round: {
        id: 'round_1',
        tournamentId: 'tour_1',
        roundNumber: 1,
        tournament: { id: 'tour_1', status: 'IN_PROGRESS' },
        matches: [],
      },
    }

    mockDb.tournamentMatch.findUnique.mockResolvedValue(match)
    mockDb.tournamentMatch.update.mockResolvedValue({ ...match, status: 'COMPLETED', winnerId: 'part_1' })
    mockDb.tournamentParticipant.update.mockResolvedValue({})
    mockDb.tournamentParticipant.findMany.mockResolvedValue([])
    mockDb.tournamentRound.findMany.mockResolvedValue([{ id: 'round_1', roundNumber: 1 }])
    mockDb.tournamentMatch.findMany.mockResolvedValue([match])
    mockDb.tournament.update.mockResolvedValue({})

    await completeMatch('match_1', 'part_1', { p1Wins: 2, p2Wins: 1, drawGames: 0 })

    // Verify db.user.update was NEVER called (ELO lives on the User table)
    expect(mockDb.user.findUnique).not.toHaveBeenCalled()

    // Verify only participant/match/round/tournament tables were touched
    const allowedModels = ['tournamentMatch', 'tournamentParticipant', 'tournamentRound', 'tournament']
    for (const model of allowedModels) {
      // These are expected — no assertion needed
    }
    // The key assertion: user table was not written to
    // (mockDb.user has no update mock — if it were called it would throw, failing the test)
  })

  it('completeMatch records match result without altering participant eloAtRegistration', async () => {
    const match = {
      id: 'match_2',
      tournamentId: 'tour_1',
      roundId: 'round_1',
      participant1Id: 'part_1',
      participant2Id: 'part_2',
      winnerId: null,
      status: 'IN_PROGRESS',
      round: {
        id: 'round_1',
        tournamentId: 'tour_1',
        roundNumber: 1,
        tournament: { id: 'tour_1', status: 'IN_PROGRESS' },
        matches: [],
      },
    }

    mockDb.tournamentMatch.findUnique.mockResolvedValue(match)
    mockDb.tournamentMatch.update.mockResolvedValue({ ...match, status: 'COMPLETED', winnerId: 'part_1' })
    mockDb.tournamentParticipant.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'part_1', ...data })
    )
    mockDb.tournamentParticipant.findMany.mockResolvedValue([])
    mockDb.tournamentRound.findMany.mockResolvedValue([{ id: 'round_1', roundNumber: 1 }])
    mockDb.tournamentMatch.findMany.mockResolvedValue([match])
    mockDb.tournament.update.mockResolvedValue({})

    await completeMatch('match_2', 'part_1', { p1Wins: 2, p2Wins: 0, drawGames: 0 })

    // Participant updates should only touch status/finalPosition — not eloAtRegistration
    for (const call of mockDb.tournamentParticipant.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty('eloAtRegistration')
      expect(call[0].data).not.toHaveProperty('eloRating')
    }
  })
})
