// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, vi } from 'vitest'
import { assertBotHasSkillForGame } from '../registrationGuards.js'

// Phase 3.8.2.5 / 3.8.5.3 — guard rail for tournament registration. The
// route was previously happy to enrol any bot regardless of skills; the
// match would then fail at start time when no BotSkill could resolve.
// These tests pin down the four observable behaviours: humans pass through
// unchanged; bots with the right skill pass; bots without it return a
// clear NO_SKILL 400; the right (botId, gameId) is queried.

function makeDb() {
  return {
    botSkill: { findFirst: vi.fn() },
  }
}

describe('assertBotHasSkillForGame', () => {
  it('passes humans straight through (the guard only applies to bots)', async () => {
    const db = makeDb()
    const result = await assertBotHasSkillForGame({ db, userId: 'usr_human', isBot: false, gameId: 'xo' })
    expect(result).toEqual({ ok: true })
    expect(db.botSkill.findFirst).not.toHaveBeenCalled()
  })

  it('passes bots that have a BotSkill for the tournament game', async () => {
    const db = makeDb()
    db.botSkill.findFirst.mockResolvedValue({ id: 'sk_xo_42' })
    const result = await assertBotHasSkillForGame({ db, userId: 'bot_x', isBot: true, gameId: 'xo' })
    expect(result).toEqual({ ok: true })
    expect(db.botSkill.findFirst).toHaveBeenCalledWith({
      where:  { botId: 'bot_x', gameId: 'xo' },
      select: { id: true },
    })
  })

  it('returns a 400 NO_SKILL with a Gym-pointing message when the bot has no matching skill', async () => {
    const db = makeDb()
    db.botSkill.findFirst.mockResolvedValue(null)
    const result = await assertBotHasSkillForGame({ db, userId: 'bot_skilless', isBot: true, gameId: 'xo' })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.body.code).toBe('NO_SKILL')
    expect(result.body.error).toMatch(/no skill for "xo"/i)
    expect(result.body.error).toMatch(/Gym/i)
  })

  it('keys the lookup by the requested gameId — wrong game = no skill', async () => {
    const db = makeDb()
    db.botSkill.findFirst.mockImplementation(async ({ where }) => (
      where.botId === 'bot_xo_only' && where.gameId === 'xo'
        ? { id: 'sk_xo_only' }
        : null
    ))

    const xoCheck = await assertBotHasSkillForGame({ db, userId: 'bot_xo_only', isBot: true, gameId: 'xo' })
    const c4Check = await assertBotHasSkillForGame({ db, userId: 'bot_xo_only', isBot: true, gameId: 'connect4' })

    expect(xoCheck.ok).toBe(true)
    expect(c4Check.ok).toBe(false)
    expect(c4Check.body.code).toBe('NO_SKILL')
  })
})
