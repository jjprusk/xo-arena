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
    tournament: { findMany: vi.fn() },
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

const { recoverPendingBotMatches } = await import('../tournamentSweep.js')
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
