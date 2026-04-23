// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Unit tests for recoverPendingBotMatches — the startup-recovery path that
 * re-publishes tournament:bot:match:ready events for bot-vs-bot matches
 * stuck in PENDING after a backend restart. QA_Phase_3.4 §11g item 3.
 *
 * Verifies that (a) the function publishes exactly one event per pending
 * bot-vs-bot match, (b) every payload carries `gameId`, and (c) matches
 * involving any human participant are NOT re-published (only bot vs bot).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Module-under-test mocks ──────────────────────────────────────────────────

vi.mock('../db.js', () => ({
  default: {
    tournament: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), findUnique: vi.fn() },
    tournamentParticipant: { findUnique: vi.fn() },
  },
}))

vi.mock('../redis.js', () => ({
  publish: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../logger.js', () => ({
  default: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
  },
}))

const { recoverPendingBotMatches, sweep, autoCancel, allParticipantsAreBots } = await import('../tournamentSweep.js')
const db      = (await import('../db.js')).default
const { publish } = await import('../redis.js')

// ── Fixture helpers ──────────────────────────────────────────────────────────

function botUser(id, name, modelId) {
  return { id, displayName: name, botModelId: modelId, isBot: true }
}
function humanUser(id, name) {
  return { id, displayName: name, botModelId: null, isBot: false }
}
function participant(id, user) {
  return { id, userId: user.id, user }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('recoverPendingBotMatches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('re-publishes one tournament:bot:match:ready per PENDING bot-vs-bot match, with gameId', async () => {
    const bot1 = botUser('bot_A', 'Rusty',   'seed:rusty:novice')
    const bot2 = botUser('bot_B', 'Magnus',  'seed:magnus:master')
    const p1 = participant('p1', bot1)
    const p2 = participant('p2', bot2)

    db.tournament.findMany.mockResolvedValue([
      {
        id:       't_xo',
        bestOfN:  3,
        game:     'xo',
        rounds: [{
          matches: [
            { id: 'm1', status: 'PENDING', participant1Id: 'p1', participant2Id: 'p2' },
          ],
        }],
      },
    ])
    db.tournamentParticipant.findUnique.mockImplementation(async ({ where }) =>
      where.id === 'p1' ? p1 : where.id === 'p2' ? p2 : null,
    )

    await recoverPendingBotMatches()

    expect(publish).toHaveBeenCalledTimes(1)
    const [channel, payload] = publish.mock.calls[0]
    expect(channel).toBe('tournament:bot:match:ready')
    expect(payload).toEqual({
      tournamentId: 't_xo',
      matchId:      'm1',
      bestOfN:      3,
      gameId:       'xo',
      bot1: { id: 'bot_A', displayName: 'Rusty',  botModelId: 'seed:rusty:novice'  },
      bot2: { id: 'bot_B', displayName: 'Magnus', botModelId: 'seed:magnus:master' },
    })
  })

  it('skips matches where either participant is human (HvB or HvH should not be re-published here)', async () => {
    const bot   = botUser('bot_A', 'Rusty', 'seed:rusty:novice')
    const human = humanUser('usr_x', 'Alice')
    const pBot   = participant('p_bot',   bot)
    const pHuman = participant('p_human', human)

    db.tournament.findMany.mockResolvedValue([
      {
        id: 't_mixed', bestOfN: 1, game: 'xo',
        rounds: [{
          matches: [
            { id: 'm_hvb', status: 'PENDING', participant1Id: 'p_human', participant2Id: 'p_bot' },
          ],
        }],
      },
    ])
    db.tournamentParticipant.findUnique.mockImplementation(async ({ where }) =>
      where.id === 'p_bot' ? pBot : where.id === 'p_human' ? pHuman : null,
    )

    await recoverPendingBotMatches()

    expect(publish).not.toHaveBeenCalled()
  })

  it('skips matches missing a participant (byes, in-progress pairing races)', async () => {
    db.tournament.findMany.mockResolvedValue([
      {
        id: 't_bye', bestOfN: 1, game: 'xo',
        rounds: [{
          matches: [
            { id: 'm_bye', status: 'PENDING', participant1Id: 'p1', participant2Id: null },
          ],
        }],
      },
    ])

    await recoverPendingBotMatches()

    expect(db.tournamentParticipant.findUnique).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('publishes gameId from the tournament row — proving the field is not hardcoded', async () => {
    const b1 = botUser('x1', 'Alpha', 'seed:alpha:novice')
    const b2 = botUser('x2', 'Beta',  'seed:beta:master')
    db.tournament.findMany.mockResolvedValue([
      {
        id: 't_future_game', bestOfN: 5, game: 'connect4',
        rounds: [{
          matches: [
            { id: 'm_c4', status: 'PENDING', participant1Id: 'px1', participant2Id: 'px2' },
          ],
        }],
      },
    ])
    db.tournamentParticipant.findUnique.mockImplementation(async ({ where }) =>
      where.id === 'px1' ? participant('px1', b1) : participant('px2', b2),
    )

    await recoverPendingBotMatches()

    expect(publish.mock.calls[0][1].gameId).toBe('connect4')
  })
})

// ─── Phase 1 close — null-close fallback to startTime ────────────────────────

describe('sweep — Phase 1 close', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Defaults so Phase 2 and recovery paths don't throw when we don't care
    db.tournament.findMany.mockResolvedValue([])
    db.tournament.updateMany.mockResolvedValue({ count: 0 })
    db.tournament.findUnique.mockResolvedValue(null)
  })

  it('selects REGISTRATION_OPEN tournaments with null close AND past startTime alongside ones with an explicit close', async () => {
    await sweep()

    const phaseOneCall = db.tournament.findMany.mock.calls.find(
      ([args]) => args.where?.status === 'REGISTRATION_OPEN',
    )
    expect(phaseOneCall, 'Phase 1 close query was issued').toBeDefined()
    const where = phaseOneCall[0].where
    expect(where.OR).toEqual([
      expect.objectContaining({ registrationCloseAt: expect.objectContaining({ not: null }) }),
      expect.objectContaining({ registrationCloseAt: null, startTime: expect.objectContaining({ not: null }) }),
    ])
  })
})

// ─── autoCancel: drop-vs-cancel decision ─────────────────────────────────────
// Unfilled recurring occurrences with only seed bots should silently disappear
// (no row, no Redis event, no notification). Tournaments where a real human
// registered should keep the existing CANCELLED + notify behavior.

describe('allParticipantsAreBots', () => {
  it('returns true for an all-bot participant list', () => {
    expect(allParticipantsAreBots([
      { user: { isBot: true } },
      { user: { isBot: true } },
    ])).toBe(true)
  })
  it('returns true for an empty list (vacuous)', () => {
    expect(allParticipantsAreBots([])).toBe(true)
    expect(allParticipantsAreBots(undefined)).toBe(true)
  })
  it('returns false as soon as one human is present', () => {
    expect(allParticipantsAreBots([
      { user: { isBot: true } },
      { user: { isBot: false } },
    ])).toBe(false)
  })
  it('treats missing user data as non-bot (safer)', () => {
    expect(allParticipantsAreBots([
      { user: { isBot: true } },
      { userId: 'u_x' },   // no user object
    ])).toBe(false)
  })
})

describe('autoCancel', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('DELETES (not cancels) when only seed bots are registered — no tournament:cancelled event', async () => {
    const bot1 = botUser('bot_rusty',  'Rusty',  'seed:rusty:novice')
    const bot2 = botUser('bot_copper', 'Copper', 'seed:copper:novice')
    const tournament = {
      id: 't_unfilled',
      name: 'Daily 3-Player',
      minParticipants: 3,
      participants: [
        { userId: 'bot_rusty',  user: bot1 },
        { userId: 'bot_copper', user: bot2 },
      ],
    }

    await autoCancel(tournament, 2)

    expect(db.tournament.delete).toHaveBeenCalledWith({ where: { id: 't_unfilled' } })
    expect(db.tournament.update).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('also DELETES when the tournament has zero participants', async () => {
    const tournament = {
      id: 't_empty', name: 'Empty', minParticipants: 2, participants: [],
    }
    await autoCancel(tournament, 0)
    expect(db.tournament.delete).toHaveBeenCalledWith({ where: { id: 't_empty' } })
    expect(publish).not.toHaveBeenCalled()
  })

  it('CANCELS (not deletes) when a human is registered — publishes tournament:cancelled so the human gets notified', async () => {
    const bot   = botUser('bot_rusty', 'Rusty', 'seed:rusty:novice')
    const alice = humanUser('usr_alice', 'Alice')
    const tournament = {
      id: 't_under',
      name: 'Daily 3-Player',
      minParticipants: 3,
      participants: [
        { userId: 'bot_rusty',  user: bot },
        { userId: 'usr_alice',  user: alice },
      ],
    }

    await autoCancel(tournament, 2)

    expect(db.tournament.delete).not.toHaveBeenCalled()
    expect(db.tournament.update).toHaveBeenCalledWith({
      where: { id: 't_under' },
      data: { status: 'CANCELLED' },
    })
    expect(publish).toHaveBeenCalledWith('tournament:cancelled', {
      tournamentId: 't_under',
      name: 'Daily 3-Player',
      participantUserIds: ['bot_rusty', 'usr_alice'],
    })
  })
})
