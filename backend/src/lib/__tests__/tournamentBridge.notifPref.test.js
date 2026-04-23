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
  userNotification: { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
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
  mockDb.userNotification.create.mockResolvedValue({ id: 'n_created' })
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

  it('does not emit real-time socket events — all warning tiers flow via SSE', async () => {
    const io = makeIo()

    for (const minutesUntilStart of [60, 15, 2]) {
      await handleEvent(io, 'tournament:warning', {
        tournamentId: 'tour_1',
        minutesUntilStart,
        participantUserIds: ['user_1'],
      })
    }

    // 15-min is delivered by scheduledJobs directly via appendToStream; 60/2
    // flow through dispatch(). Neither path touches io.to anymore.
    expect(io.to).not.toHaveBeenCalled()
  })
})

// ─── Per-registration pref takes precedence over global default ───────────────

describe('tournament:match:result — per-registration pref takes precedence over global default', () => {
  it('dispatches match.result live for a participant registered with AS_PLAYED', async () => {
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

    expect(io.to).not.toHaveBeenCalled()
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'match.result',
      targets: { userId: 'user_1' },
      payload: expect.any(Object),
    })
    expect(mockDb.userNotification.create).not.toHaveBeenCalled()
  })

  it('holds match.result for a participant registered with END_OF_TOURNAMENT', async () => {
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

    // EOT: no live dispatch; a UserNotification row is persisted for the
    // tournament:completed flush to surface later.
    expect(mockDispatch).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'match.result',
      targets: { userId: 'user_1' },
    }))
    expect(mockDb.userNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user_1',
        type: 'match.result',
        payload: expect.objectContaining({ tournamentId: 'tour_1', matchId: 'match_1' }),
      }),
    })
  })
})

describe('tournament:match:result — notification preference gating', () => {
  it('dispatches live for all AS_PLAYED participants', async () => {
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

    expect(io.to).not.toHaveBeenCalled()
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

  it('persists a UserNotification (without dispatch) for END_OF_TOURNAMENT and dispatches AS_PLAYED live', async () => {
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

    expect(io.to).not.toHaveBeenCalled()

    // user_1 is END_OF_TOURNAMENT: no dispatch, row is persisted directly.
    expect(mockDispatch).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'match.result',
      targets: { userId: 'user_1' },
    }))
    expect(mockDb.userNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user_1', type: 'match.result' }),
    })

    // user_2 is AS_PLAYED: dispatched live.
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'match.result',
      targets: { userId: 'user_2' },
      payload: expect.any(Object),
    })
  })
})

describe('tournament:completed — END_OF_TOURNAMENT flush', () => {
  it('dispatches held match.result notifications for END_OF_TOURNAMENT participants at tournament end', async () => {
    const io = makeIo()

    // One EOT participant with two previously-held match.result rows.
    mockDb.tournamentParticipant.findMany.mockResolvedValue([
      { userId: 'user_eot' },
    ])
    mockDb.userNotification.findMany.mockResolvedValue([
      { id: 'n1', userId: 'user_eot', payload: { tournamentId: 'tour_1', matchId: 'match_1' } },
      { id: 'n2', userId: 'user_eot', payload: { tournamentId: 'tour_1', matchId: 'match_2' } },
    ])

    await handleEvent(io, 'tournament:completed', {
      tournamentId: 'tour_1',
      finalStandings: [{ userId: 'user_eot', position: 1 }],
    })

    expect(io.to).not.toHaveBeenCalled()

    // Dispatches the tournament-complete notification to the EOT participant.
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tournament.completed',
      targets: { userId: 'user_eot' },
    }))

    // And re-dispatches each held match.result so SSE subscribers surface them.
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'match.result',
      targets: { userId: 'user_eot' },
      payload: expect.objectContaining({ matchId: 'match_1' }),
    }))
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'match.result',
      targets: { userId: 'user_eot' },
      payload: expect.objectContaining({ matchId: 'match_2' }),
    }))
  })
})

// ─── Recurring occurrence opened — notify auto-enrolled subscribers ──────────
// Channel `tournament:recurring:occurrence` used to be published with no
// listener (dead telemetry). The bridge now dispatches a cohort notification
// to the humans auto-enrolled via their standing RecurringTournamentRegistration.
// Seed bots and non-subscribers get nothing; no broadcast to all users.

describe('tournamentBridge — tournament:recurring:occurrence', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('dispatches tournament.recurring_occurrence_opened to auto-enrolled subscribers (cohort)', async () => {
    const io = { to: vi.fn().mockReturnValue({ emit: vi.fn() }), emit: vi.fn() }
    await handleEvent(io, 'tournament:recurring:occurrence', {
      templateId:          'tpl_daily',
      tournamentId:        'tour_mon',
      occurrenceId:        'tour_mon',
      name:                'Daily 3-Player',
      startTime:           '2026-04-23T19:00:00.000Z',
      autoEnrolledUserIds: ['usr_alice', 'usr_bob'],
    })

    expect(mockDispatch).toHaveBeenCalledTimes(1)
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type:    'tournament.recurring_occurrence_opened',
      targets: { cohort: ['usr_alice', 'usr_bob'] },
      payload: {
        tournamentId: 'tour_mon',
        name:         'Daily 3-Player',
        startTime:    '2026-04-23T19:00:00.000Z',
      },
    }))
    // Must NOT broadcast — this event is deliberately per-subscriber only.
    expect(io.emit).not.toHaveBeenCalled()
    expect(io.to).not.toHaveBeenCalled()
  })

  it('no-ops when the template has no human subscribers (seed-bot-only)', async () => {
    const io = { to: vi.fn(), emit: vi.fn() }
    await handleEvent(io, 'tournament:recurring:occurrence', {
      templateId:          'tpl_bot_only',
      tournamentId:        'tour_empty',
      name:                'Bot Showcase',
      startTime:           '2026-04-23T19:00:00.000Z',
      autoEnrolledUserIds: [],
    })
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('tolerates a missing autoEnrolledUserIds field (older payload shape)', async () => {
    const io = { to: vi.fn(), emit: vi.fn() }
    await handleEvent(io, 'tournament:recurring:occurrence', {
      templateId:   'tpl_legacy',
      tournamentId: 'tour_legacy',
      startTime:    '2026-04-23T19:00:00.000Z',
    })
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('passes dynamic expiresAt = startTime so the "you\'re entered" notification auto-clears at tournament start', async () => {
    const io = { to: vi.fn().mockReturnValue({ emit: vi.fn() }), emit: vi.fn() }
    const futureStart = new Date(Date.now() + 6 * 60 * 60_000).toISOString() // 6h out
    await handleEvent(io, 'tournament:recurring:occurrence', {
      tournamentId:        'tour_x',
      name:                'Evening 3',
      startTime:           futureStart,
      autoEnrolledUserIds: ['usr_alice'],
    })
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type:      'tournament.recurring_occurrence_opened',
      expiresAt: futureStart,
    }))
  })
})

// ─── pickNotificationCutoff helper ────────────────────────────────────────────

const { pickNotificationCutoff } = await import('../tournamentBridge.js')

describe('pickNotificationCutoff', () => {
  it('returns the earliest future candidate as an ISO string', () => {
    const inOneHour  = new Date(Date.now() + 60 * 60_000).toISOString()
    const inTwoHours = new Date(Date.now() + 2 * 60 * 60_000).toISOString()
    expect(pickNotificationCutoff(inTwoHours, inOneHour)).toBe(inOneHour)
  })
  it('ignores candidates in the past', () => {
    const past   = new Date(Date.now() - 60 * 60_000).toISOString()
    const future = new Date(Date.now() + 60 * 60_000).toISOString()
    expect(pickNotificationCutoff(past, future)).toBe(future)
  })
  it('returns null when all candidates are null/undefined/past', () => {
    const past = new Date(Date.now() - 60 * 60_000).toISOString()
    expect(pickNotificationCutoff(null, undefined, past)).toBeNull()
    expect(pickNotificationCutoff()).toBeNull()
  })
  it('accepts Date objects as well as ISO strings', () => {
    const d = new Date(Date.now() + 30 * 60_000)
    expect(pickNotificationCutoff(d)).toBe(d.toISOString())
  })
  it('ignores unparseable strings', () => {
    const good = new Date(Date.now() + 60 * 60_000).toISOString()
    expect(pickNotificationCutoff('not-a-date', good)).toBe(good)
  })
})
