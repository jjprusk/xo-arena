// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 5 — `tournament:completed` grants the §5.7 "first non-Curriculum
 * tournament win" discovery reward to position-1 finishers in non-cup
 * tournaments. Cup wins are explicitly excluded (the Curriculum Cup is a
 * guided funnel step, not an open win).
 *
 * Tests cover:
 *   - non-cup + position 1 → grantDiscoveryReward('firstRealTournamentWin')
 *   - non-cup + position 2 → no grant (only winners)
 *   - cup + position 1     → no grant (cup wins excluded)
 *   - bot owner attribution → grant goes to the human owner, not the bot
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

import { grantDiscoveryReward as mockGrant } from '../../services/discoveryRewardsService.js'
const { handleEvent } = await import('../tournamentBridge.js')

function makeIo() {
  const emit = vi.fn()
  const to   = vi.fn().mockReturnValue({ emit })
  return { to, emit }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.user.findUnique.mockResolvedValue({ isBot: false, botOwnerId: null })
  mockDb.tournamentParticipant.findMany.mockResolvedValue([])
  mockDb.tournamentParticipant.count.mockResolvedValue(4)
  mockDb.userNotification.findMany.mockResolvedValue([])
})

describe('tournament:completed → firstRealTournamentWin discovery reward', () => {
  it('grants firstRealTournamentWin on a non-cup position-1 finish', async () => {
    mockDb.tournament.findUnique.mockResolvedValue({ isCup: false })
    await handleEvent(makeIo(), 'tournament:completed', {
      tournamentId:   'open-1',
      name:           'Open Tournament',
      finalStandings: [{ userId: 'user-winner', position: 1 }],
    })
    expect(mockGrant).toHaveBeenCalledWith('user-winner', 'firstRealTournamentWin')
  })

  it('does NOT grant for non-winning positions in a non-cup tournament', async () => {
    mockDb.tournament.findUnique.mockResolvedValue({ isCup: false })
    await handleEvent(makeIo(), 'tournament:completed', {
      tournamentId:   'open-2',
      name:           'Open Tournament',
      finalStandings: [
        { userId: 'user-second', position: 2 },
        { userId: 'user-third',  position: 3 },
      ],
    })
    expect(mockGrant).not.toHaveBeenCalled()
  })

  it('does NOT grant when the position-1 finish is in a cup (Curriculum Cup excluded)', async () => {
    mockDb.tournament.findUnique.mockResolvedValue({ isCup: true })
    await handleEvent(makeIo(), 'tournament:completed', {
      tournamentId:   'cup-1',
      name:           'Curriculum Cup',
      finalStandings: [{ userId: 'user-winner', position: 1 }],
    })
    expect(mockGrant).not.toHaveBeenCalled()
  })

  it('attributes the grant to the human bot-owner, not the bot user', async () => {
    mockDb.tournament.findUnique.mockResolvedValue({ isCup: false })
    // The winning participant is a bot owned by user-owner
    mockDb.user.findUnique.mockResolvedValue({ isBot: true, botOwnerId: 'user-owner' })
    await handleEvent(makeIo(), 'tournament:completed', {
      tournamentId:   'open-3',
      name:           'Open Tournament',
      finalStandings: [{ userId: 'bot-id', position: 1 }],
    })
    expect(mockGrant).toHaveBeenCalledWith('user-owner', 'firstRealTournamentWin')
  })

  it('survives a grant rejection (fire-and-forget)', async () => {
    mockDb.tournament.findUnique.mockResolvedValue({ isCup: false })
    mockGrant.mockRejectedValueOnce(new Error('grant down'))
    await expect(handleEvent(makeIo(), 'tournament:completed', {
      tournamentId:   'open-4',
      name:           'Open Tournament',
      finalStandings: [{ userId: 'user-winner', position: 1 }],
    })).resolves.toBeUndefined()
  })
})
