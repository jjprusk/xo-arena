// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 4 — `tournament:completed` emits a coaching card to the cup
 * creator alongside the existing tournament.completed dispatch + step 7.
 *
 * Tests cover:
 *   - cup completion + finalPosition=1 → CHAMPION card emitted
 *   - cup completion + finalPosition=2 → RUNNER_UP card emitted
 *   - cup completion + lost-in-semis → HEAVY_LOSS card (didTrainImprove=false in v1)
 *   - non-cup tournament completion → no coaching card
 *   - finalPosition null → no coaching card (eliminated-without-position)
 *   - missing io → no emission attempt (defensive)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  user:                  { findUnique: vi.fn() },
  tournament:            { findUnique: vi.fn() },
  tournamentMatch:       { findUnique: vi.fn() },
  tournamentParticipant: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  userNotification:      { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
}
vi.mock('../db.js', () => ({ default: mockDb }))
vi.mock('../notificationBus.js', () => ({ dispatch: vi.fn().mockResolvedValue(undefined) }))
const { mockAppendToStream } = vi.hoisted(() => ({
  mockAppendToStream: vi.fn().mockResolvedValue('1-0'),
}))
vi.mock('../eventStream.js', () => ({ appendToStream: mockAppendToStream }))
vi.mock('ioredis', () => {
  const Redis = vi.fn(() => ({ on: vi.fn(), subscribe: vi.fn() }))
  return { default: Redis }
})
vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../../services/journeyService.js', () => ({
  completeStep: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../services/discoveryRewardsService.js', () => ({
  grantDiscoveryReward: vi.fn().mockResolvedValue(undefined),
}))

const { handleEvent } = await import('../tournamentBridge.js')

function makeIo() {
  const emit = vi.fn()
  const to   = vi.fn().mockReturnValue({ emit })
  return { to, emit, _emit: emit }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: each user is the human (not a bot)
  mockDb.user.findUnique.mockResolvedValue({ isBot: false, botOwnerId: null })
  mockDb.tournamentParticipant.findMany.mockResolvedValue([])
  mockDb.tournamentParticipant.count.mockResolvedValue(4)
  mockDb.userNotification.findMany.mockResolvedValue([])
})

describe('tournament:completed — coaching card emission', () => {
  function findCardCall(channel = 'guide:coaching_card') {
    return mockAppendToStream.mock.calls.find(([ch]) => ch === channel)
  }

  it('appends CHAMPION card when an isCup tournament finishes with the user at position 1', async () => {
    mockDb.tournament.findUnique.mockResolvedValue({ isCup: true })
    await handleEvent(null, 'tournament:completed', {
      tournamentId:   'cup-1',
      name:           'Curriculum Cup',
      finalStandings: [{ userId: 'user-caller', position: 1 }],
    })
    const sseCall = findCardCall()
    expect(sseCall).toBeDefined()
    expect(sseCall[1].card.id).toBe('champion')
    expect(sseCall[1].finalPosition).toBe(1)
    expect(sseCall[2]).toEqual({ userId: 'user-caller' })
  })

  it('appends RUNNER_UP card on position 2', async () => {
    mockDb.tournament.findUnique.mockResolvedValue({ isCup: true })
    await handleEvent(null, 'tournament:completed', {
      tournamentId:   'cup-2',
      name:           'Curriculum Cup',
      finalStandings: [{ userId: 'user-caller', position: 2 }],
    })
    expect(findCardCall()[1].card.id).toBe('runner_up')
  })

  it('appends HEAVY_LOSS card on position 3 in a 4-bot bracket (didTrainImprove=false)', async () => {
    mockDb.tournament.findUnique.mockResolvedValue({ isCup: true })
    mockDb.tournamentParticipant.count.mockResolvedValue(4)
    await handleEvent(null, 'tournament:completed', {
      tournamentId:   'cup-3',
      name:           'Curriculum Cup',
      finalStandings: [{ userId: 'user-caller', position: 3 }],
    })
    expect(findCardCall()[1].card.id).toBe('heavy_loss')
  })

  it('does NOT append a coaching card for non-cup tournaments', async () => {
    mockDb.tournament.findUnique.mockResolvedValue({ isCup: false })
    await handleEvent(null, 'tournament:completed', {
      tournamentId:   'reg-1',
      name:           'Regular',
      finalStandings: [{ userId: 'user-caller', position: 1 }],
    })
    expect(findCardCall()).toBeUndefined()
  })

  it('does NOT append a coaching card when the user has no finalPosition', async () => {
    mockDb.tournament.findUnique.mockResolvedValue({ isCup: true })
    mockDb.tournamentParticipant.findMany.mockResolvedValue([{ userId: 'user-caller' }])
    await handleEvent(null, 'tournament:completed', {
      tournamentId:   'cup-4',
      name:           'Curriculum Cup',
      finalStandings: [],
    })
    expect(findCardCall()).toBeUndefined()
  })
})
