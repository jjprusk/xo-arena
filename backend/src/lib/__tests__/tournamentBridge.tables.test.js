/**
 * Phase 3.1 (Option A): tournamentBridge writes Table rows alongside the
 * existing TournamentMatch flow so the Tables page surfaces tournament games.
 *
 * Covered:
 * - tournament:match:ready → creates a Table with isTournament=true and both
 *   participants pre-seated
 * - Failure to create the Table doesn't break the rest of the match-ready flow
 * - tournament:match:result → flips the corresponding Table to COMPLETED
 *
 * The Phase 3.4 conversion deletes both writes; this test file should be
 * removed at that time too.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  table:                 { create: vi.fn(), updateMany: vi.fn() },
  tournament:            { findUnique: vi.fn() },
  tournamentMatch:       { findUnique: vi.fn() },
  tournamentParticipant: { findUnique: vi.fn(), findMany: vi.fn() },
  userNotification:      { findMany: vi.fn(), updateMany: vi.fn() },
  user:                  { findUnique: vi.fn() },
}

vi.mock('../db.js', () => ({ default: mockDb }))

const mockDispatch = vi.fn().mockResolvedValue(undefined)
vi.mock('../notificationBus.js', () => ({ dispatch: mockDispatch }))

vi.mock('ioredis', () => ({
  default: vi.fn(() => ({ on: vi.fn(), subscribe: vi.fn() })),
}))

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../../services/journeyService.js', () => ({
  completeStep: vi.fn().mockResolvedValue(undefined),
}))

const { handleEvent } = await import('../tournamentBridge.js')
const { default: logger } = await import('../../logger.js')

function makeIo() {
  const emitFn = vi.fn()
  const toFn = vi.fn().mockReturnValue({ emit: emitFn })
  return { to: toFn, emit: vi.fn(), _emit: emitFn }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDispatch.mockResolvedValue(undefined)
  mockDb.tournament.findUnique.mockResolvedValue({ game: 'xo' })
  mockDb.table.create.mockResolvedValue({ id: 'tbl_1' })
  mockDb.table.updateMany.mockResolvedValue({ count: 1 })
  mockDb.userNotification.findMany.mockResolvedValue([])
  mockDb.userNotification.updateMany.mockResolvedValue({ count: 0 })
  mockDb.tournamentParticipant.findMany.mockResolvedValue([])
  mockDb.user.findUnique.mockResolvedValue(null)
})

// ── tournament:match:ready ────────────────────────────────────────────────────

describe('tournament:match:ready → creates a Table (Phase 3.1 Option A)', () => {
  it('creates a Table with both participants pre-seated', async () => {
    const io = makeIo()
    await handleEvent(io, 'tournament:match:ready', {
      tournamentId:        'tour_1',
      matchId:             'match_1',
      participant1UserId:  'user_a',
      participant2UserId:  'user_b',
      bestOfN:             3,
    })

    expect(mockDb.tournament.findUnique).toHaveBeenCalledWith({
      where: { id: 'tour_1' },
      select: { game: true },
    })
    expect(mockDb.table.create).toHaveBeenCalledWith({
      data: {
        gameId:       'xo',
        createdById:  'user_a',
        minPlayers:   2,
        maxPlayers:   2,
        isPrivate:    false,
        isTournament: true,
        seats: [
          { userId: 'user_a', status: 'occupied' },
          { userId: 'user_b', status: 'occupied' },
        ],
      },
    })
  })

  it('skips Table create when only one participant is known (bye round)', async () => {
    const io = makeIo()
    await handleEvent(io, 'tournament:match:ready', {
      tournamentId:        'tour_1',
      matchId:             'match_bye',
      participant1UserId:  'user_a',
      participant2UserId:  null,
      bestOfN:             1,
    })
    expect(mockDb.table.create).not.toHaveBeenCalled()
  })

  it('skips Table create when the tournament has no game configured', async () => {
    mockDb.tournament.findUnique.mockResolvedValue(null)
    const io = makeIo()
    await handleEvent(io, 'tournament:match:ready', {
      tournamentId:        'tour_orphan',
      matchId:             'match_1',
      participant1UserId:  'user_a',
      participant2UserId:  'user_b',
    })
    expect(mockDb.table.create).not.toHaveBeenCalled()
  })

  it('Table create failure is logged but does not throw', async () => {
    mockDb.table.create.mockRejectedValue(new Error('db down'))
    const io = makeIo()
    await expect(handleEvent(io, 'tournament:match:ready', {
      tournamentId:        'tour_1',
      matchId:             'match_1',
      participant1UserId:  'user_a',
      participant2UserId:  'user_b',
    })).resolves.not.toThrow()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ tournamentId: 'tour_1', matchId: 'match_1' }),
      expect.stringMatching(/tournament Table create failed/i),
    )
  })

  it('still emits match.ready notifications when the Table create fails', async () => {
    mockDb.table.create.mockRejectedValue(new Error('boom'))
    const io = makeIo()
    await handleEvent(io, 'tournament:match:ready', {
      tournamentId:        'tour_1',
      matchId:             'match_1',
      participant1UserId:  'user_a',
      participant2UserId:  'user_b',
    })
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'match.ready',
      targets: { userId: 'user_a' },
    }))
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'match.ready',
      targets: { userId: 'user_b' },
    }))
  })
})

// ── tournament:match:result ───────────────────────────────────────────────────

describe('tournament:match:result → marks Table COMPLETED (Phase 3.1 Option A)', () => {
  beforeEach(() => {
    mockDb.tournamentMatch.findUnique.mockResolvedValue({
      id:             'match_1',
      participant1Id: 'part_1',
      participant2Id: 'part_2',
      round:          { tournament: { participants: [] } },
    })
    mockDb.tournamentParticipant.findUnique.mockImplementation(({ where: { id } }) => {
      if (id === 'part_1') return Promise.resolve({ userId: 'user_a', resultNotifPref: 'AS_PLAYED' })
      if (id === 'part_2') return Promise.resolve({ userId: 'user_b', resultNotifPref: 'AS_PLAYED' })
      return Promise.resolve(null)
    })
  })

  it('flips matching tournament Table to COMPLETED on result', async () => {
    const io = makeIo()
    await handleEvent(io, 'tournament:match:result', {
      tournamentId: 'tour_1',
      matchId:      'match_1',
      winnerId:     'part_1',
      p1Wins:       2,
      p2Wins:       1,
      drawGames:    0,
    })
    expect(mockDb.table.updateMany).toHaveBeenCalledWith({
      where: {
        isTournament: true,
        status:       { in: ['FORMING', 'ACTIVE'] },
        seats: { equals: [
          { userId: 'user_a', status: 'occupied' },
          { userId: 'user_b', status: 'occupied' },
        ] },
      },
      data: { status: 'COMPLETED' },
    })
  })

  it('skips Table update when participant resolution failed', async () => {
    mockDb.tournamentParticipant.findUnique.mockResolvedValue(null)
    const io = makeIo()
    await handleEvent(io, 'tournament:match:result', {
      tournamentId: 'tour_1',
      matchId:      'match_1',
      winnerId:     null,
      p1Wins:       0,
      p2Wins:       0,
      drawGames:    0,
    })
    expect(mockDb.table.updateMany).not.toHaveBeenCalled()
  })

  it('Table updateMany failure is logged but does not throw', async () => {
    mockDb.table.updateMany.mockRejectedValue(new Error('db down'))
    const io = makeIo()
    await expect(handleEvent(io, 'tournament:match:result', {
      tournamentId: 'tour_1',
      matchId:      'match_1',
      winnerId:     'part_1',
      p1Wins:       2,
      p2Wins:       0,
      drawGames:    0,
    })).resolves.not.toThrow()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ matchId: 'match_1' }),
      expect.stringMatching(/Table COMPLETED update failed/i),
    )
  })
})
