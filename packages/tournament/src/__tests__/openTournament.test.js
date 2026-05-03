/**
 * Phase 4: Open tournament format tests
 *
 * Covers:
 * - Registration allowed when REGISTRATION_OPEN (format=OPEN)
 * - Registration rejected when tournament IN_PROGRESS
 * - startTournament can be called from REGISTRATION_OPEN (no REGISTRATION_CLOSED step needed)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  user: { findUnique: vi.fn() },
  tournament: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  tournamentParticipant: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  tournamentRound: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  tournamentMatch: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  systemConfig: { findUnique: vi.fn() },
  playerClassification: { findUnique: vi.fn(), create: vi.fn() },
  meritTransaction: { create: vi.fn() },
  classificationHistory: { create: vi.fn() },
  meritThreshold: { findMany: vi.fn() },
}

vi.mock('@xo-arena/db', () => ({ default: mockDb }))
vi.mock('../lib/redis.js', () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../lib/botJobQueue.js', () => ({ enqueueJob: vi.fn().mockResolvedValue(undefined) }))

const { registerParticipant, startTournament } = await import('../services/tournamentService.js')

beforeEach(() => {
  vi.resetAllMocks()
  mockDb.systemConfig.findUnique.mockResolvedValue(null)
  mockDb.playerClassification.findUnique.mockResolvedValue({ id: 'c1', userId: 'u1', tier: 'RECRUIT', merits: 0 })
})

describe('Open tournament format', () => {
  it('allows registration when OPEN format tournament is REGISTRATION_OPEN', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1', eloRating: 1200 })
    mockDb.tournament.findUnique.mockResolvedValue({
      id: 'tour_1',
      status: 'REGISTRATION_OPEN',
      format: 'OPEN',
      mode: 'HVH',
      maxParticipants: null,
      botMinGamesPlayed: null,
      allowNonCompetitiveBots: false,
      _count: { participants: 2 },
    })
    mockDb.tournamentParticipant.findUnique.mockResolvedValue(null)
    mockDb.tournamentParticipant.create.mockResolvedValue({
      id: 'part_1', tournamentId: 'tour_1', userId: 'user_1', status: 'REGISTERED',
    })

    const result = await registerParticipant('tour_1', 'ba_1')
    expect(result.status).toBe('REGISTERED')
  })

  it('rejects registration when OPEN format tournament is IN_PROGRESS', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1', eloRating: 1200 })
    mockDb.tournament.findUnique.mockResolvedValue({
      id: 'tour_1',
      status: 'IN_PROGRESS',
      format: 'OPEN',
      mode: 'HVH',
      maxParticipants: null,
      _count: { participants: 4 },
    })

    await expect(registerParticipant('tour_1', 'ba_1')).rejects.toMatchObject({ status: 409 })
  })

  it('startTournament on OPEN format does not set REGISTRATION_CLOSED', async () => {
    const participants = [
      { id: 'p1', userId: 'u1', eloAtRegistration: 1400, user: { betterAuthId: 'ba1', eloRating: 1400 } },
      { id: 'p2', userId: 'u2', eloAtRegistration: 1300, user: { betterAuthId: 'ba2', eloRating: 1300 } },
      { id: 'p3', userId: 'u3', eloAtRegistration: 1200, user: { betterAuthId: 'ba3', eloRating: 1200 } },
      { id: 'p4', userId: 'u4', eloAtRegistration: 1100, user: { betterAuthId: 'ba4', eloRating: 1100 } },
    ]
    const tournament = {
      id: 'tour_1',
      status: 'REGISTRATION_OPEN',
      format: 'OPEN',
      mode: 'HVH',
      bracketType: 'SINGLE_ELIM',
      minParticipants: 4,
      maxParticipants: null,
      bestOfN: 3,
      durationMinutes: null,
      endTime: null,
      participants,
    }
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

    await startTournament('tour_1', 'admin_ba')

    // Should NOT have been called with REGISTRATION_CLOSED for OPEN format
    const closedCall = mockDb.tournament.update.mock.calls.find(
      c => c[0]?.data?.status === 'REGISTRATION_CLOSED'
    )
    expect(closedCall).toBeUndefined()
  })
})
