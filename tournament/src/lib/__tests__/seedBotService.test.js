// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Unit tests for Phase 3.7a template seed-bot helpers.
 *
 * The e2e spec (e2e/tests/tournament-template-clone.spec.js) covers the
 * happy path + the P2002 → 409 collision. These tests exercise the
 * validation branches without spinning up Express or the DB:
 *
 *   - missing displayName when cloning         → 400
 *   - persona not found                        → 404
 *   - persona is not a bot                     → 400
 *   - persona is user-owned                    → 400
 *   - persona is not a built-in (`bot-*`)      → 400
 *   - missing userId on mode A                 → 400
 *   - userId points at a user / user-bot       → 400
 *   - seedExistingSystemBot happy path         → 201 upsert
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  user: { findUnique: vi.fn(), create: vi.fn() },
  tournamentTemplateSeedBot: { create: vi.fn(), upsert: vi.fn() },
}
vi.mock('../db.js', () => ({ default: mockDb }))

const { cloneAndSeedPersona, seedExistingSystemBot } = await import('../seedBotService.js')

beforeEach(() => {
  vi.clearAllMocks()
})

const templateId = 'tpl_1'

describe('cloneAndSeedPersona', () => {
  it('rejects missing displayName with 400', async () => {
    const r = await cloneAndSeedPersona({ templateId, personaBotId: 'bot_rusty', displayName: '  ' })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/displayName required/i)
    expect(mockDb.user.findUnique).not.toHaveBeenCalled()
  })

  it('returns 404 when persona id does not resolve', async () => {
    mockDb.user.findUnique.mockResolvedValue(null)
    const r = await cloneAndSeedPersona({ templateId, personaBotId: 'missing', displayName: 'X' })
    expect(r.status).toBe(404)
    expect(mockDb.user.create).not.toHaveBeenCalled()
  })

  it('rejects persona that is not a bot', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'usr_1', username: 'bot-rusty', isBot: false, botOwnerId: null })
    const r = await cloneAndSeedPersona({ templateId, personaBotId: 'usr_1', displayName: 'X' })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/must be a bot/i)
  })

  it('rejects user-owned bot as a clone source', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'bot_1', username: 'bot-mine', isBot: true, botOwnerId: 'usr_owner' })
    const r = await cloneAndSeedPersona({ templateId, personaBotId: 'bot_1', displayName: 'X' })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/system bot/i)
  })

  it('rejects system bots whose username is not a built-in persona', async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: 'bot_rogue', username: 'rogue-system-bot', isBot: true, botOwnerId: null,
    })
    const r = await cloneAndSeedPersona({ templateId, personaBotId: 'bot_rogue', displayName: 'X' })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/built-in personas/i)
  })

  it('happy path: creates clone + seed and returns 201 with user', async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: 'bot_rusty', username: 'bot-rusty', isBot: true, botOwnerId: null,
      botModelType: 'minimax', botModelId: 'builtin:minimax:novice',
      botCompetitive: true, avatarUrl: null,
    })
    mockDb.user.create.mockResolvedValue({ id: 'bot_clone_1', displayName: 'Rusty Jr', username: 'bot-clone-rusty-jr-abc123' })
    mockDb.tournamentTemplateSeedBot.create.mockResolvedValue({ id: 'seed_1', templateId, userId: 'bot_clone_1' })

    const r = await cloneAndSeedPersona({ templateId, personaBotId: 'bot_rusty', displayName: 'Rusty Jr' })
    expect(r.status).toBe(201)
    expect(r.body.user.id).toBe('bot_clone_1')
    expect(r.body.seed.userId).toBe('bot_clone_1')

    // Derived fields: new botModelId preserves the persona prefix + ":clone:" suffix
    const createArg = mockDb.user.create.mock.calls[0][0]
    expect(createArg.data.botModelId.startsWith('builtin:minimax:novice:clone:')).toBe(true)
    expect(createArg.data.botOwnerId).toBeNull()
    expect(createArg.data.isBot).toBe(true)
  })

  it('maps Prisma P2002 to 409 with a helpful message', async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: 'bot_rusty', username: 'bot-rusty', isBot: true, botOwnerId: null,
      botModelType: 'minimax', botModelId: 'builtin:minimax:novice',
      botCompetitive: true, avatarUrl: null,
    })
    const err = Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target: ['lower("displayName")'] } })
    mockDb.user.create.mockRejectedValue(err)

    const r = await cloneAndSeedPersona({ templateId, personaBotId: 'bot_rusty', displayName: 'Rusty' })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/already exists/i)
  })
})

describe('seedExistingSystemBot', () => {
  it('rejects missing userId with 400', async () => {
    const r = await seedExistingSystemBot({ templateId, userId: undefined })
    expect(r.status).toBe(400)
    expect(mockDb.user.findUnique).not.toHaveBeenCalled()
  })

  it('returns 404 for unknown user', async () => {
    mockDb.user.findUnique.mockResolvedValue(null)
    const r = await seedExistingSystemBot({ templateId, userId: 'missing' })
    expect(r.status).toBe(404)
  })

  it('rejects a non-bot user', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'usr_1', isBot: false, botOwnerId: null })
    const r = await seedExistingSystemBot({ templateId, userId: 'usr_1' })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/bots can be seeded/i)
  })

  it('rejects a user-owned bot', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'bot_mine', isBot: true, botOwnerId: 'usr_owner' })
    const r = await seedExistingSystemBot({ templateId, userId: 'bot_mine' })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/system bot/i)
  })

  it('upserts on the (templateId, userId) pair and returns 201', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'bot_rusty', isBot: true, botOwnerId: null })
    mockDb.tournamentTemplateSeedBot.upsert.mockResolvedValue({ id: 'seed_1', templateId, userId: 'bot_rusty' })

    const r = await seedExistingSystemBot({ templateId, userId: 'bot_rusty' })
    expect(r.status).toBe(201)
    expect(r.body.seed.userId).toBe('bot_rusty')
    const upsertArg = mockDb.tournamentTemplateSeedBot.upsert.mock.calls[0][0]
    expect(upsertArg.where).toEqual({ templateId_userId: { templateId, userId: 'bot_rusty' } })
  })
})
