import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BUILT_IN_BOTS, RESERVED_BOT_NAMES } from '../seed.js'

// ─── Seed data shape tests (no DB required) ────────────────────────────────

describe('BUILT_IN_BOTS', () => {
  it('defines exactly 4 built-in bots', () => {
    expect(BUILT_IN_BOTS).toHaveLength(4)
  })

  it('covers all difficulty levels', () => {
    const ids = BUILT_IN_BOTS.map(b => b.botModelId)
    expect(ids).toContain('builtin:minimax:novice')
    expect(ids).toContain('builtin:minimax:intermediate')
    expect(ids).toContain('builtin:minimax:advanced')
    expect(ids).toContain('builtin:minimax:master')
  })

  it('each bot has required fields', () => {
    for (const bot of BUILT_IN_BOTS) {
      expect(bot.username).toBeTruthy()
      expect(bot.email).toMatch(/@xo-arena\.internal$/)
      expect(bot.displayName).toBeTruthy()
      expect(bot.botModelType).toBe('minimax')
      expect(bot.botModelId).toMatch(/^builtin:/)
      expect(bot.botCompetitive).toBe(true)
    }
  })

  it('all botModelIds are unique', () => {
    const ids = BUILT_IN_BOTS.map(b => b.botModelId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all usernames are unique', () => {
    const names = BUILT_IN_BOTS.map(b => b.username)
    expect(new Set(names).size).toBe(names.length)
  })

  it('all emails are unique', () => {
    const emails = BUILT_IN_BOTS.map(b => b.email)
    expect(new Set(emails).size).toBe(emails.length)
  })

  it('usernames use bot- prefix', () => {
    for (const bot of BUILT_IN_BOTS) {
      expect(bot.username).toMatch(/^bot-/)
    }
  })

  it('display names match the four personas', () => {
    const names = BUILT_IN_BOTS.map(b => b.displayName)
    expect(names).toContain('Rusty')
    expect(names).toContain('Copper')
    expect(names).toContain('Sterling')
    expect(names).toContain('Magnus')
  })
})

describe('RESERVED_BOT_NAMES', () => {
  it('contains lowercase versions of all built-in display names', () => {
    expect(RESERVED_BOT_NAMES).toContain('rusty')
    expect(RESERVED_BOT_NAMES).toContain('copper')
    expect(RESERVED_BOT_NAMES).toContain('sterling')
    expect(RESERVED_BOT_NAMES).toContain('magnus')
  })

  it('are all lowercase', () => {
    for (const name of RESERVED_BOT_NAMES) {
      expect(name).toBe(name.toLowerCase())
    }
  })

  it('has the same count as BUILT_IN_BOTS', () => {
    expect(RESERVED_BOT_NAMES).toHaveLength(BUILT_IN_BOTS.length)
  })
})
