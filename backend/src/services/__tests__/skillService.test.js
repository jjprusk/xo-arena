// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Unit tests for skillService.resolveSkillForGame — the server-side source
 * of truth for an HvB room's BotSkill (§11e of QA_Phase_3.4).
 *
 * Contract:
 *   - Queries BotSkill by the composite (botId, gameId) unique index
 *   - Returns { id, algorithm } when a row matches
 *   - Returns null when no row matches — and the socketHandler
 *     then ONLY falls back to a client-supplied botSkillId if the DB
 *     lookup came up empty. See socketHandler.js ≈ L658–L664 for the
 *     override logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/db.js', () => ({
  default: {
    botSkill: {
      findFirst:  vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

// Import AFTER the mock so the module binds to our stubbed db.
const { resolveSkillForGame } = await import('../skillService.js')
const db = (await import('../../lib/db.js')).default

describe('resolveSkillForGame', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns { id, algorithm } for a bot that has a BotSkill row for the game', async () => {
    db.botSkill.findFirst.mockResolvedValue({ id: 'sk_123', algorithm: 'q_learning' })

    const result = await resolveSkillForGame('bot_abc', 'xo')

    expect(result).toEqual({ id: 'sk_123', algorithm: 'q_learning' })
    // Verify the exact Prisma query shape — if this shifts, the unique
    // index semantics have changed and the test needs updating deliberately.
    expect(db.botSkill.findFirst).toHaveBeenCalledWith({
      where:  { botId: 'bot_abc', gameId: 'xo' },
      select: { id: true, algorithm: true },
    })
  })

  it('returns null when no BotSkill row matches (the "returned null" log path)', async () => {
    db.botSkill.findFirst.mockResolvedValue(null)
    const result = await resolveSkillForGame('bot_abc', 'xo')
    expect(result).toBeNull()
  })

  it('queries by the composite (botId, gameId) key — different gameId misses', async () => {
    // Simulate DB: bot has skill for xo, not for connect4.
    db.botSkill.findFirst.mockImplementation(async ({ where }) => {
      if (where.botId === 'bot_abc' && where.gameId === 'xo') {
        return { id: 'sk_xo_1', algorithm: 'minimax' }
      }
      return null
    })

    expect(await resolveSkillForGame('bot_abc', 'xo')).toEqual({ id: 'sk_xo_1', algorithm: 'minimax' })
    expect(await resolveSkillForGame('bot_abc', 'connect4')).toBeNull()
    expect(await resolveSkillForGame('bot_xyz', 'xo')).toBeNull()
  })
})

/**
 * Documents the socketHandler `room:create:hvb` override contract (§11e
 * item 3). The handler accepts a client-supplied `botSkillId` but re-
 * resolves from DB; the resolved value wins whenever the DB has a row.
 *
 * We replicate the 4-line logic here as a pure function so the contract
 * is testable without standing up a socket.io harness. A regression in
 * the handler (e.g., accidentally trusting the client first) will drift
 * from this baseline.
 */
async function resolveHvbSkillId({ clientBotSkillId, botUserId, gameId }, findSkill) {
  let resolvedSkillId = clientBotSkillId || null
  const skill = await findSkill(botUserId, gameId)
  if (skill) resolvedSkillId = skill.id
  return resolvedSkillId
}

describe('socketHandler room:create:hvb — resolved skill override contract', () => {
  it('ignores a client-supplied botSkillId when the DB has a matching skill', async () => {
    const findSkill = vi.fn().mockResolvedValue({ id: 'sk_from_db', algorithm: 'minimax' })

    const resolved = await resolveHvbSkillId(
      { clientBotSkillId: 'sk_FAKE_from_client', botUserId: 'bot_abc', gameId: 'xo' },
      findSkill,
    )

    expect(resolved).toBe('sk_from_db')
    expect(findSkill).toHaveBeenCalledWith('bot_abc', 'xo')
  })

  it('falls back to the client-supplied id only when the DB lookup returns null', async () => {
    const findSkill = vi.fn().mockResolvedValue(null)

    const resolved = await resolveHvbSkillId(
      { clientBotSkillId: 'sk_client_fallback', botUserId: 'bot_abc', gameId: 'xo' },
      findSkill,
    )

    expect(resolved).toBe('sk_client_fallback')
  })

  it('returns null when neither the DB nor the client provides a skill id', async () => {
    const findSkill = vi.fn().mockResolvedValue(null)

    const resolved = await resolveHvbSkillId(
      { clientBotSkillId: null, botUserId: 'bot_abc', gameId: 'xo' },
      findSkill,
    )

    expect(resolved).toBeNull()
  })
})
