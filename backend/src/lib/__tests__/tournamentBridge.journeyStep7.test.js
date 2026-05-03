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

  it('credits step 7 for the CHAMPION (finalPosition=1) — winner gets graduation', async () => {
    // CHAMPION outcome: user's bot won the cup. Step 7 must credit so the
    // user transitions to Specialize phase along with the coaching card.
    db.tournamentParticipant.findMany.mockResolvedValue([
      { userId: 'bot-mine', finalPosition: 1 },
      { userId: 'bot-r',    finalPosition: 2 },
      { userId: 'bot-3',    finalPosition: 3 },
      { userId: 'bot-4',    finalPosition: 3 },
    ])
    db.user.findUnique.mockImplementation(({ where }) => {
      if (where.id === 'bot-mine') return Promise.resolve({ isBot: true, botOwnerId: 'human-1' })
      return Promise.resolve({ isBot: true, botOwnerId: null })
    })

    await handleEvent(null, 'tournament:completed', {
      tournamentId: 'cup_1',
      name: 'Curriculum Cup',
      finalStandings: [
        { userId: 'bot-mine', position: 1 },
        { userId: 'bot-r',    position: 2 },
      ],
    })

    const human1Calls = mockCompleteStep.mock.calls.filter(([uid, step]) => uid === 'human-1' && step === 7)
    expect(human1Calls.length).toBe(1)
  })

  it('credits step 7 for the RUNNER_UP (finalPosition=2) — final-loser gets graduation', async () => {
    db.tournamentParticipant.findMany.mockResolvedValue([
      { userId: 'bot-w',    finalPosition: 1 },
      { userId: 'bot-mine', finalPosition: 2 },
      { userId: 'bot-3',    finalPosition: 3 },
      { userId: 'bot-4',    finalPosition: 3 },
    ])
    db.user.findUnique.mockImplementation(({ where }) => {
      if (where.id === 'bot-mine') return Promise.resolve({ isBot: true, botOwnerId: 'human-2' })
      return Promise.resolve({ isBot: true, botOwnerId: null })
    })

    await handleEvent(null, 'tournament:completed', {
      tournamentId: 'cup_2',
      name: 'Curriculum Cup',
      finalStandings: [
        { userId: 'bot-w',    position: 1 },
        { userId: 'bot-mine', position: 2 },
      ],
    })

    const human2Calls = mockCompleteStep.mock.calls.filter(([uid, step]) => uid === 'human-2' && step === 7)
    expect(human2Calls.length).toBe(1)
  })

  it('credits step 7 for ALL four cup outcome variants in one shot (smoke test)', async () => {
    // Single 4-bot cup where all 4 humans own one bot each. Every owner
    // must credit step 7, regardless of finishing position. Catches a
    // regression where step 7 became position-gated (e.g., "only winners
    // graduate") without that being a deliberate decision.
    db.tournamentParticipant.findMany.mockResolvedValue([
      { userId: 'bot-1', finalPosition: 1 },  // CHAMPION
      { userId: 'bot-2', finalPosition: 2 },  // RUNNER_UP
      { userId: 'bot-3', finalPosition: 3 },  // HEAVY_LOSS
      { userId: 'bot-4', finalPosition: 3 },  // HEAVY_LOSS
    ])
    db.user.findUnique.mockImplementation(({ where }) => {
      if (where.id === 'bot-1') return Promise.resolve({ isBot: true, botOwnerId: 'human-1' })
      if (where.id === 'bot-2') return Promise.resolve({ isBot: true, botOwnerId: 'human-2' })
      if (where.id === 'bot-3') return Promise.resolve({ isBot: true, botOwnerId: 'human-3' })
      if (where.id === 'bot-4') return Promise.resolve({ isBot: true, botOwnerId: 'human-4' })
      return Promise.resolve(null)
    })

    await handleEvent(null, 'tournament:completed', {
      tournamentId: 'cup_3',
      name: 'Curriculum Cup',
      finalStandings: [
        { userId: 'bot-1', position: 1 },
        { userId: 'bot-2', position: 2 },
      ],
    })

    for (const human of ['human-1', 'human-2', 'human-3', 'human-4']) {
      const calls = mockCompleteStep.mock.calls.filter(([uid, step]) => uid === human && step === 7)
      expect(calls.length).toBe(1)
    }
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
