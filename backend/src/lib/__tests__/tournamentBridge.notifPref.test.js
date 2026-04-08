/**
 * Phase 5: tournamentBridge notification preference tests
 *
 * Covers:
 * 1. AS_PLAYED participant: Socket.io emit fires immediately on match result
 * 2. END_OF_TOURNAMENT participant: no real-time emit on match result, but notification queued
 * 3. At tournament:completed: END_OF_TOURNAMENT participant receives a batch of match results
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock db ─────────────────────────────────────────────────────────────────

const mockDb = {
  tournamentMatch: { findUnique: vi.fn() },
  tournamentParticipant: { findUnique: vi.fn(), findMany: vi.fn() },
  userNotification: { findMany: vi.fn(), updateMany: vi.fn() },
}

vi.mock('../db.js', () => ({ default: mockDb }))

// ─── Mock notificationService ─────────────────────────────────────────────────

const mockQueueNotification = vi.fn().mockResolvedValue({ id: 'notif_1' })
vi.mock('../../services/notificationService.js', () => ({
  queueNotification: mockQueueNotification,
}))

// ─── Mock ioredis (required by tournamentBridge module-level import) ──────────

vi.mock('ioredis', () => {
  const Redis = vi.fn(() => ({
    on: vi.fn(),
    subscribe: vi.fn(),
  }))
  return { default: Redis }
})

// ─── Mock logger ─────────────────────────────────────────────────────────────

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ─── Import handleEvent directly (exported for testability) ──────────────────

const { handleEvent } = await import('../tournamentBridge.js')

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIo() {
  const emitFn = vi.fn()
  const toFn = vi.fn().mockReturnValue({ emit: emitFn })
  return { to: toFn, emit: vi.fn(), _emit: emitFn }
}

function makeMatch() {
  return {
    id: 'match_1',
    tournamentId: 'tour_1',
    participant1Id: 'part_1',
    participant2Id: 'part_2',
    winnerId: 'part_1',
    p1Wins: 2,
    p2Wins: 1,
    drawGames: 0,
    round: { tournament: { participants: [] } },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockQueueNotification.mockResolvedValue({ id: 'notif_1' })
  mockDb.userNotification.findMany.mockResolvedValue([])
  mockDb.userNotification.updateMany.mockResolvedValue({ count: 0 })
  mockDb.tournamentParticipant.findMany.mockResolvedValue([])
})

// ─── Tests ────────────────────────────────────────────────────────────────────

// ─── Flash broadcast ─────────────────────────────────────────────────────────

describe('tournament:flash:announced — global broadcast', () => {
  it('emits guide:notification to all connected sockets', async () => {
    const io = makeIo()

    await handleEvent(io, 'tournament:flash:announced', {
      tournamentId: 'tour_flash',
      name: 'Midday Blitz',
      noticePeriodMinutes: 5,
      durationMinutes: 30,
      startTime: new Date().toISOString(),
    })

    expect(io.emit).toHaveBeenCalledOnce()
    const [event, payload] = io.emit.mock.calls[0]
    expect(event).toBe('guide:notification')
    expect(payload.type).toBe('flash')
    expect(payload.title).toBe('Flash Tournament: Midday Blitz')
    expect(payload.body).toContain('5 min')
    expect(payload.href).toBe('/tournaments')
    expect(payload.tournamentId).toBe('tour_flash')
  })

  it('does not emit to individual user rooms', async () => {
    const io = makeIo()

    await handleEvent(io, 'tournament:flash:announced', {
      tournamentId: 'tour_flash',
      name: 'Quick Fire',
      noticePeriodMinutes: null,
      durationMinutes: 15,
      startTime: null,
    })

    expect(io.to).not.toHaveBeenCalled()
  })

  it('handles null noticePeriodMinutes gracefully', async () => {
    const io = makeIo()

    await handleEvent(io, 'tournament:flash:announced', {
      tournamentId: 'tour_flash',
      name: 'Surprise Tournament',
      noticePeriodMinutes: null,
      durationMinutes: 20,
      startTime: null,
    })

    expect(io.emit).toHaveBeenCalledOnce()
    const [, payload] = io.emit.mock.calls[0]
    // Body should not contain "null" or crash
    expect(payload.body).not.toContain('null')
    expect(payload.body).toContain('Register now')
  })
})

describe('tournament:match:result — notification preference gating', () => {
  it('emits real-time immediately for AS_PLAYED participant', async () => {
    const io = makeIo()

    mockDb.tournamentMatch.findUnique.mockResolvedValue(makeMatch())
    mockDb.tournamentParticipant.findUnique
      .mockResolvedValueOnce({ userId: 'user_1', resultNotifPref: 'AS_PLAYED' })
      .mockResolvedValueOnce({ userId: 'user_2', resultNotifPref: 'AS_PLAYED' })

    await handleEvent(io, 'tournament:match:result', {
      tournamentId: 'tour_1',
      matchId: 'match_1',
      winnerId: 'part_1',
      p1Wins: 2,
      p2Wins: 1,
      drawGames: 0,
    })

    // Both AS_PLAYED participants should get real-time emit
    expect(io.to).toHaveBeenCalledWith('user:user_1')
    expect(io.to).toHaveBeenCalledWith('user:user_2')
    expect(mockQueueNotification).toHaveBeenCalledWith('user_1', 'tournament_match_result', expect.any(Object))
    expect(mockQueueNotification).toHaveBeenCalledWith('user_2', 'tournament_match_result', expect.any(Object))
  })

  it('does NOT emit real-time for END_OF_TOURNAMENT participant but queues notification', async () => {
    const io = makeIo()

    mockDb.tournamentMatch.findUnique.mockResolvedValue(makeMatch())
    mockDb.tournamentParticipant.findUnique
      .mockResolvedValueOnce({ userId: 'user_1', resultNotifPref: 'END_OF_TOURNAMENT' })
      .mockResolvedValueOnce({ userId: 'user_2', resultNotifPref: 'AS_PLAYED' })

    await handleEvent(io, 'tournament:match:result', {
      tournamentId: 'tour_1',
      matchId: 'match_1',
      winnerId: 'part_1',
      p1Wins: 2,
      p2Wins: 1,
      drawGames: 0,
    })

    // user_1 is END_OF_TOURNAMENT: should NOT get a real-time emit
    const toCallArgs = io.to.mock.calls.map(c => c[0])
    expect(toCallArgs).not.toContain('user:user_1')

    // user_2 is AS_PLAYED: should get real-time emit
    expect(toCallArgs).toContain('user:user_2')

    // Both should have their notification queued
    expect(mockQueueNotification).toHaveBeenCalledWith('user_1', 'tournament_match_result', expect.any(Object))
    expect(mockQueueNotification).toHaveBeenCalledWith('user_2', 'tournament_match_result', expect.any(Object))
  })
})

describe('tournament:completed — END_OF_TOURNAMENT flush', () => {
  it('emits batch of match results to END_OF_TOURNAMENT participant at tournament end', async () => {
    const io = makeIo()

    // END_OF_TOURNAMENT participant
    mockDb.tournamentParticipant.findMany.mockResolvedValue([
      { userId: 'user_eot' },
    ])

    // Two pending match result notifications for this user
    mockDb.userNotification.findMany.mockResolvedValue([
      { id: 'n1', payload: { tournamentId: 'tour_1', matchId: 'match_1' } },
      { id: 'n2', payload: { tournamentId: 'tour_1', matchId: 'match_2' } },
    ])
    mockDb.userNotification.updateMany.mockResolvedValue({ count: 2 })

    await handleEvent(io, 'tournament:completed', {
      tournamentId: 'tour_1',
      finalStandings: [{ userId: 'user_eot', position: 1 }],
    })

    // Collect all (room, event, data) tuples from io.to(...).emit(...)
    const allEmits = []
    for (let i = 0; i < io.to.mock.calls.length; i++) {
      const room = io.to.mock.calls[i][0]
      const emitResult = io.to.mock.results[i].value
      for (const emitCall of emitResult.emit.mock.calls) {
        allEmits.push({ room, event: emitCall[0], data: emitCall[1] })
      }
    }

    const batchEmit = allEmits.find(
      c => c.event === 'tournament:match:results:batch' && c.room === 'user:user_eot'
    )
    expect(batchEmit).toBeDefined()
    expect(batchEmit.data.matchIds).toEqual(['match_1', 'match_2'])

    // Notifications should be marked delivered
    expect(mockDb.userNotification.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['n1', 'n2'] } },
      data: { deliveredAt: expect.any(Date) },
    })
  })
})
