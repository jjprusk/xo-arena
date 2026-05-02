// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Wiring of `tournament:completed` → Curriculum step 7.
 *
 * Step 7 ("See your bot's first result") fires for every owner whose bot
 * had a non-null finalPosition in the completed tournament. Critical
 * regression guard: round-1 losers in a 4-bot SINGLE_ELIM cup are NOT in
 * `finalStandings` (only 1st + 2nd are), but their TournamentParticipant
 * row still has finalPosition=3. The bridge must read that from the DB
 * and credit step 7 — otherwise a user whose cup bot loses round 1 never
 * graduates the curriculum.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  default: {
    user: { findUnique: vi.fn() },
    tournament: { findUnique: vi.fn() },
    tournamentMatch: { findUnique: vi.fn() },
    tournamentParticipant: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    userNotification: { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  },
}))
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
vi.mock('../../services/notificationService.js', () => ({
  sendCoachingCard: vi.fn().mockResolvedValue(undefined),
}))

import db from '../db.js'
import { completeStep as mockCompleteStep } from '../../services/journeyService.js'
const { handleEvent } = await import('../tournamentBridge.js')

beforeEach(() => {
  vi.clearAllMocks()
  db.tournament.findUnique.mockResolvedValue({ isCup: true })
  db.tournamentParticipant.count.mockResolvedValue(4)
  db.userNotification.findMany.mockResolvedValue([])
  db.userNotification.updateMany.mockResolvedValue({ count: 0 })
  db.userNotification.create.mockResolvedValue({})
})

describe('tournament:completed → journey step 7', () => {
  it('credits step 7 for round-1 losers (finalPosition=3) NOT in finalStandings', async () => {
    // 4-bot cup: human owns bot-mine, lost round 1.
    // finalStandings only carries the winner (bot-w) and runner-up (bot-r).
    db.tournamentParticipant.findMany.mockResolvedValue([
      { userId: 'bot-w',    finalPosition: 1 },
      { userId: 'bot-r',    finalPosition: 2 },
      { userId: 'bot-mine', finalPosition: 3 },
      { userId: 'bot-other',finalPosition: 3 },
    ])
    db.user.findUnique.mockImplementation(({ where }) => {
      if (where.id === 'bot-w')    return Promise.resolve({ isBot: true, botOwnerId: null })
      if (where.id === 'bot-r')    return Promise.resolve({ isBot: true, botOwnerId: null })
      if (where.id === 'bot-mine') return Promise.resolve({ isBot: true, botOwnerId: 'human-1' })
      if (where.id === 'bot-other')return Promise.resolve({ isBot: true, botOwnerId: null })
      return Promise.resolve(null)
    })

    await handleEvent(null, 'tournament:completed', {
      tournamentId: 'cup_1',
      name: 'Curriculum Cup',
      finalStandings: [
        { userId: 'bot-w', position: 1 },
        { userId: 'bot-r', position: 2 },
      ],
    })

    // Step 7 must fire for the round-1-losing bot's owner.
    const human1Calls = mockCompleteStep.mock.calls.filter(([uid, step]) => uid === 'human-1' && step === 7)
    expect(human1Calls.length).toBe(1)
  })

  it('does NOT credit step 7 when the owner has no bot in the tournament (no finalPosition row)', async () => {
    db.tournamentParticipant.findMany.mockResolvedValue([])
    db.user.findUnique.mockResolvedValue({ isBot: false, botOwnerId: null })

    await handleEvent(null, 'tournament:completed', {
      tournamentId: 'cup_1',
      name: 'Curriculum Cup',
      finalStandings: [],
    })

    expect(mockCompleteStep).not.toHaveBeenCalledWith(expect.anything(), 7)
  })

  it('credits step 7 once per owner even when they own multiple bot participants', async () => {
    // Owner has two bots — one finished 2nd, one finished 3rd. Best-position
    // de-duping should still result in ONE step-7 credit.
    db.tournamentParticipant.findMany.mockResolvedValue([
      { userId: 'bot-w',  finalPosition: 1 },
      { userId: 'bot-a',  finalPosition: 2 },
      { userId: 'bot-b',  finalPosition: 3 },
      { userId: 'bot-c',  finalPosition: 3 },
    ])
    db.user.findUnique.mockImplementation(({ where }) => {
      if (where.id === 'bot-w') return Promise.resolve({ isBot: true, botOwnerId: null })
      if (where.id === 'bot-a') return Promise.resolve({ isBot: true, botOwnerId: 'human-x' })
      if (where.id === 'bot-b') return Promise.resolve({ isBot: true, botOwnerId: 'human-x' })
      if (where.id === 'bot-c') return Promise.resolve({ isBot: true, botOwnerId: null })
      return Promise.resolve(null)
    })

    await handleEvent(null, 'tournament:completed', {
      tournamentId: 'cup_1',
      name: 'Curriculum Cup',
      finalStandings: [
        { userId: 'bot-w', position: 1 },
        { userId: 'bot-a', position: 2 },
      ],
    })

    const xCalls = mockCompleteStep.mock.calls.filter(([uid, step]) => uid === 'human-x' && step === 7)
    expect(xCalls.length).toBe(1)
  })
})
