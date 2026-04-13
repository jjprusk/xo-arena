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
  user: { findUnique: vi.fn() },
}

vi.mock('../db.js', () => ({ default: mockDb }))

// ─── Mock notificationBus ─────────────────────────────────────────────────────

const mockDispatch = vi.fn().mockResolvedValue(undefined)
vi.mock('../notificationBus.js', () => ({
  dispatch: mockDispatch,
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

// ─── Mock journeyService (completeStep is fire-and-forget) ───────────────────

vi.mock('../../services/journeyService.js', () => ({
  completeStep: vi.fn().mockResolvedValue(undefined),
}))

// Capture reference so we can re-set implementation after vi.resetAllMocks()
import { completeStep as mockCompleteStep } from '../../services/journeyService.js'

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
  mockDispatch.mockResolvedValue(undefined)
  // vi.resetAllMocks() clears the implementation — must restore so .catch() doesn't throw
  mockCompleteStep.mockResolvedValue(undefined)
  mockDb.userNotification.findMany.mockResolvedValue([])
  mockDb.userNotification.updateMany.mockResolvedValue({ count: 0 })
  mockDb.tournamentParticipant.findMany.mockResolvedValue([])
  mockDb.user.findUnique.mockResolvedValue(null) // non-bot by default
})

// ─── Tests ────────────────────────────────────────────────────────────────────

// ─── Flash broadcast ─────────────────────────────────────────────────────────

describe('tournament:flash:announced — global broadcast', () => {
  it('dispatches tournament.flash_announced as broadcast', async () => {
    const io = makeIo()

    await handleEvent(io, 'tournament:flash:announced', {
      tournamentId: 'tour_flash',
      name: 'Midday Blitz',
      noticePeriodMinutes: 5,
      durationMinutes: 30,
      startTime: new Date().toISOString(),
    })

    expect(mockDispatch).toHaveBeenCalledOnce()
    const [args] = mockDispatch.mock.calls[0]
    expect(args.type).toBe('tournament.flash_announced')
    expect(args.targets).toEqual({ broadcast: true })
    expect(args.payload).toMatchObject({ tournamentId: 'tour_flash', name: 'Midday Blitz', noticePeriodMinutes: 5 })
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

    expect(mockDispatch).toHaveBeenCalledOnce()
    const [args] = mockDispatch.mock.calls[0]
    expect(args.payload.noticePeriodMinutes).toBeNull()
  })
})

describe('tournament:warning — 2-min warning persistence', () => {
  it('dispatches tournament.starting_soon for minutesUntilStart=2', async () => {
    const io = makeIo()

    await handleEvent(io, 'tournament:warning', {
      tournamentId: 'tour_1',
      minutesUntilStart: 2,
      participantUserIds: ['user_1', 'user_2'],
    })

    expect(mockDispatch).toHaveBeenCalledTimes(2)
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'tournament.starting_soon',
      targets: { userId: 'user_1' },
      payload: expect.objectContaining({ tournamentId: 'tour_1', minutesUntilStart: 2 }),
    })
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'tournament.starting_soon',
      targets: { userId: 'user_2' },
      payload: expect.objectContaining({ tournamentId: 'tour_1', minutesUntilStart: 2 }),
    })
  })

  it('dispatches for 60-min but NOT for 15-min', async () => {
    const io = makeIo()

    await handleEvent(io, 'tournament:warning', {
      tournamentId: 'tour_1',
      minutesUntilStart: 15,
      participantUserIds: ['user_1'],
    })

    expect(mockDispatch).not.toHaveBeenCalled()

    vi.clearAllMocks()
    mockDispatch.mockResolvedValue(undefined)

    await handleEvent(io, 'tournament:warning', {
      tournamentId: 'tour_1',
      minutesUntilStart: 60,
      participantUserIds: ['user_1'],
    })

    expect(mockDispatch).toHaveBeenCalledOnce()
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'tournament.starting_soon',
      targets: { userId: 'user_1' },
      payload: expect.objectContaining({ minutesUntilStart: 60 }),
    })
  })

  it('emits real-time socket event for all warning tiers', async () => {
    const io = makeIo()

    for (const minutesUntilStart of [60, 15, 2]) {
      await handleEvent(io, 'tournament:warning', {
        tournamentId: 'tour_1',
        minutesUntilStart,
        participantUserIds: ['user_1'],
      })
    }

    // io.to called once per tier (one participant each)
    expect(io.to).toHaveBeenCalledTimes(3)
    expect(io.to).toHaveBeenCalledWith('user:user_1')
  })
})

// ─── Per-registration pref takes precedence over global default ───────────────

describe('tournament:match:result — per-registration pref takes precedence over global default', () => {
  it('delivers AS_PLAYED for a participant registered with AS_PLAYED', async () => {
    const io = makeIo()

    mockDb.tournamentMatch.findUnique.mockResolvedValue(makeMatch())
    mockDb.tournamentParticipant.findUnique
      .mockResolvedValueOnce({ userId: 'user_1', resultNotifPref: 'AS_PLAYED' })
      .mockResolvedValueOnce(null)

    await handleEvent(io, 'tournament:match:result', {
      tournamentId: 'tour_1',
      matchId: 'match_1',
      winnerId: 'part_1',
      p1Wins: 2, p2Wins: 0, drawGames: 0,
    })

    // Real-time emit fired immediately (AS_PLAYED behaviour)
    expect(io.to).toHaveBeenCalledWith('user:user_1')
    // Notification dispatched via bus
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'match.result',
      targets: { userId: 'user_1' },
      payload: expect.any(Object),
    })
  })

  it('withholds real-time for a participant registered with END_OF_TOURNAMENT', async () => {
    const io = makeIo()

    mockDb.tournamentMatch.findUnique.mockResolvedValue(makeMatch())
    mockDb.tournamentParticipant.findUnique
      .mockResolvedValueOnce({ userId: 'user_1', resultNotifPref: 'END_OF_TOURNAMENT' })
      .mockResolvedValueOnce(null)

    await handleEvent(io, 'tournament:match:result', {
      tournamentId: 'tour_1',
      matchId: 'match_1',
      winnerId: 'part_1',
      p1Wins: 2, p2Wins: 0, drawGames: 0,
    })

    // No real-time emit — END_OF_TOURNAMENT holds results until tournament end
    const toCallArgs = io.to.mock.calls.map(c => c[0])
    expect(toCallArgs).not.toContain('user:user_1')
    // But notification is still queued for the end-of-tournament flush
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'match.result',
      targets: { userId: 'user_1' },
      payload: expect.any(Object),
    })
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
    // Both dispatched via bus
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'match.result',
      targets: { userId: 'user_1' },
      payload: expect.any(Object),
    })
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'match.result',
      targets: { userId: 'user_2' },
      payload: expect.any(Object),
    })
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

    // Both should have their notification dispatched via bus
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'match.result',
      targets: { userId: 'user_1' },
      payload: expect.any(Object),
    })
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'match.result',
      targets: { userId: 'user_2' },
      payload: expect.any(Object),
    })
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
      { id: 'n1', userId: 'user_eot', payload: { tournamentId: 'tour_1', matchId: 'match_1' } },
      { id: 'n2', userId: 'user_eot', payload: { tournamentId: 'tour_1', matchId: 'match_2' } },
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
