/**
 * Phase 4: Flash tournament lifecycle tests
 *
 * Covers:
 * - forceResolveMatch: p1 leading → p1 wins
 * - forceResolveMatch: p2 leading → p2 wins
 * - forceResolveMatch: tied → ELO tiebreak
 * - forceResolveMatch: tied equal ELO → random winner selected
 * - forceResolveMatch: already completed → no-op
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  tournamentMatch: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  tournamentParticipant: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  tournamentRound: { findMany: vi.fn(), update: vi.fn() },
  tournament: { findUnique: vi.fn(), update: vi.fn() },
  systemConfig: { findUnique: vi.fn() },
  playerClassification: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  meritTransaction: { create: vi.fn() },
  classificationHistory: { create: vi.fn(), findFirst: vi.fn() },
  meritThreshold: { findMany: vi.fn() },
}

vi.mock('@xo-arena/db', () => ({ default: mockDb }))
vi.mock('../lib/redis.js', () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../lib/botJobQueue.js', () => ({ enqueueJob: vi.fn().mockResolvedValue(undefined) }))

const { forceResolveMatch } = await import('../services/tournamentService.js')

function makeMatch(overrides = {}) {
  return {
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
      tournament: { id: 'tour_1', status: 'IN_PROGRESS', bracketType: 'SINGLE_ELIM', mode: 'HVH', format: 'FLASH' },
      matches: [],
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockDb.systemConfig.findUnique.mockResolvedValue(null)
  mockDb.playerClassification.findUnique.mockResolvedValue(null)
  mockDb.playerClassification.create.mockResolvedValue({ id: 'c1', merits: 0, tier: 'RECRUIT' })
  mockDb.meritThreshold.findMany.mockResolvedValue([])
})

describe('forceResolveMatch', () => {
  it('awards win to p1 when p1 is leading', async () => {
    const match = makeMatch({ p1Wins: 2, p2Wins: 0 })
    const completedMatch = { ...match, status: 'COMPLETED', winnerId: 'part_1' }
    // forceResolveMatch calls findUnique, then completeMatch calls findUnique again
    mockDb.tournamentMatch.findUnique
      .mockResolvedValueOnce(match)         // forceResolveMatch lookup
      .mockResolvedValueOnce(match)         // completeMatch lookup
      .mockResolvedValueOnce(completedMatch) // final findUnique at end of completeMatch
    mockDb.tournamentMatch.update.mockResolvedValue(completedMatch)
    mockDb.tournamentParticipant.update.mockResolvedValue({})
    mockDb.tournamentRound.findMany.mockResolvedValue([{ id: 'round_1', roundNumber: 1 }])
    mockDb.tournamentMatch.findMany.mockResolvedValue([match])
    mockDb.tournament.update.mockResolvedValue({})
    mockDb.tournamentParticipant.findMany.mockResolvedValue([])

    await forceResolveMatch('match_1')

    const updateCall = mockDb.tournamentMatch.update.mock.calls[0]
    expect(updateCall[0].data.winnerId).toBe('part_1')
  })

  it('awards win to p2 when p2 is leading', async () => {
    const match = makeMatch({ p1Wins: 0, p2Wins: 2 })
    const completedMatch = { ...match, status: 'COMPLETED', winnerId: 'part_2' }
    mockDb.tournamentMatch.findUnique
      .mockResolvedValueOnce(match)
      .mockResolvedValueOnce(match)
      .mockResolvedValueOnce(completedMatch)
    mockDb.tournamentMatch.update.mockResolvedValue(completedMatch)
    mockDb.tournamentParticipant.update.mockResolvedValue({})
    mockDb.tournamentRound.findMany.mockResolvedValue([{ id: 'round_1', roundNumber: 1 }])
    mockDb.tournamentMatch.findMany.mockResolvedValue([match])
    mockDb.tournament.update.mockResolvedValue({})
    mockDb.tournamentParticipant.findMany.mockResolvedValue([])

    await forceResolveMatch('match_1')

    const updateCall = mockDb.tournamentMatch.update.mock.calls[0]
    expect(updateCall[0].data.winnerId).toBe('part_2')
  })

  it('uses ELO tiebreak when scores are tied', async () => {
    const match = makeMatch({ p1Wins: 1, p2Wins: 1 })
    const completedMatch = { ...match, status: 'COMPLETED', winnerId: 'part_1' }
    mockDb.tournamentMatch.findUnique
      .mockResolvedValueOnce(match)
      .mockResolvedValueOnce(match)
      .mockResolvedValueOnce(completedMatch)
    // p1 has higher ELO
    mockDb.tournamentParticipant.findUnique
      .mockResolvedValueOnce({ id: 'part_1', eloAtRegistration: 1500 }) // p1
      .mockResolvedValueOnce({ id: 'part_2', eloAtRegistration: 1200 }) // p2
    mockDb.tournamentMatch.update.mockResolvedValue(completedMatch)
    mockDb.tournamentParticipant.update.mockResolvedValue({})
    mockDb.tournamentRound.findMany.mockResolvedValue([{ id: 'round_1', roundNumber: 1 }])
    mockDb.tournamentMatch.findMany.mockResolvedValue([match])
    mockDb.tournament.update.mockResolvedValue({})
    mockDb.tournamentParticipant.findMany.mockResolvedValue([])

    await forceResolveMatch('match_1')

    const updateCall = mockDb.tournamentMatch.update.mock.calls[0]
    expect(updateCall[0].data.winnerId).toBe('part_1')
    expect(updateCall[0].data.drawResolution).toBe('ELO')
  })

  it('is a no-op for completed matches', async () => {
    mockDb.tournamentMatch.findUnique.mockResolvedValueOnce(
      makeMatch({ status: 'COMPLETED', winnerId: 'part_1' })
    )

    await forceResolveMatch('match_1')

    expect(mockDb.tournamentMatch.update).not.toHaveBeenCalled()
  })
})
