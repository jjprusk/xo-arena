// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Unit tests for cloneCurriculumCup (Intelligent Guide §5.4).
 *
 * Covers:
 *   - happy path: 4-participant bracket, user at slot 0, opponents drawn
 *     from name pools (2 Rusty + 1 Copper, no duplicates)
 *   - bot ownership / inactive guards (selectCallerBot)
 *   - publish() emissions: participant:joined (step 6 trigger),
 *     bot:match:ready (×2 round-1 matches), tournament:started
 *   - cup is created with isCup=true, status=IN_PROGRESS, deterministic
 *     seeding, createdById=caller
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  user:                  { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  tournament:            { create: vi.fn() },
  tournamentRound:       { create: vi.fn() },
  tournamentMatch:       { create: vi.fn() },
  tournamentParticipant: { create: vi.fn() },
}
vi.mock('../db.js', () => ({ default: mockDb }))

const mockPublish = vi.fn().mockResolvedValue(undefined)
vi.mock('../redis.js', () => ({ publish: mockPublish }))

const { cloneCurriculumCup, selectCallerBot } = await import('../curriculumCupService.js')

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CALLER_ID  = 'user-caller'
const CALLER_BOT = { id: 'bot-mine', displayName: 'My Bot', botModelId: 'user:user-caller:minimax:novice', isBot: true, botActive: true, botOwnerId: CALLER_ID }
const RUSTY      = { id: 'sysbot-rusty',  isBot: true, botModelType: 'minimax', botModelId: 'builtin:minimax:novice',       botCompetitive: true, avatarUrl: null }
const COPPER     = { id: 'sysbot-copper', isBot: true, botModelType: 'minimax', botModelId: 'builtin:minimax:intermediate', botCompetitive: true, avatarUrl: null }

beforeEach(() => {
  vi.clearAllMocks()

  // Default: caller-bot lookups, persona lookups by username
  mockDb.user.findUnique.mockImplementation(({ where }) => {
    if (where.id === 'bot-mine')       return Promise.resolve(CALLER_BOT)
    if (where.username === 'bot-rusty')  return Promise.resolve(RUSTY)
    if (where.username === 'bot-copper') return Promise.resolve(COPPER)
    return Promise.resolve(null)
  })
  mockDb.user.findFirst.mockResolvedValue(CALLER_BOT)

  // Each cup-opponent clone gets a unique id
  let cloneCounter = 0
  mockDb.user.create.mockImplementation(({ data, select }) => {
    cloneCounter++
    return Promise.resolve({
      id:           `cup-clone-${cloneCounter}`,
      displayName:  data.displayName,
      botModelId:   data.botModelId,
      isBot:        data.isBot,
    })
  })

  let participantCounter = 0
  mockDb.tournament.create.mockImplementation(({ data, select }) => Promise.resolve({
    id:      'cup-1',
    name:    data.name,
    game:    data.game,
    bestOfN: data.bestOfN,
  }))
  mockDb.tournamentParticipant.create.mockImplementation(({ data, select }) => {
    participantCounter++
    return Promise.resolve({
      id:           `part-${participantCounter}`,
      seedPosition: data.seedPosition,
    })
  })
  mockDb.tournamentRound.create.mockResolvedValue({ id: 'round-1' })
  mockDb.tournamentMatch.create.mockImplementation(({ data }) => Promise.resolve({ id: `match-${data.participant1Id}-${data.participant2Id}` }))
})

// ─── selectCallerBot ─────────────────────────────────────────────────────────

describe('selectCallerBot', () => {
  it('returns the bot when myBotId is provided and owned', async () => {
    const r = await selectCallerBot({ callerId: CALLER_ID, myBotId: 'bot-mine' })
    expect(r.bot).toEqual(expect.objectContaining({ id: 'bot-mine' }))
  })

  it('returns 404 when the bot id resolves to nothing', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce(null)
    const r = await selectCallerBot({ callerId: CALLER_ID, myBotId: 'missing' })
    expect(r.error.status).toBe(404)
  })

  it('returns 403 when caller does not own the bot', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ ...CALLER_BOT, botOwnerId: 'someone-else' })
    const r = await selectCallerBot({ callerId: CALLER_ID, myBotId: 'bot-mine' })
    expect(r.error.status).toBe(403)
  })

  it('returns 409 when the bot is inactive', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ ...CALLER_BOT, botActive: false })
    const r = await selectCallerBot({ callerId: CALLER_ID, myBotId: 'bot-mine' })
    expect(r.error.status).toBe(409)
  })

  it('auto-picks most-recent owned bot when myBotId is absent', async () => {
    const r = await selectCallerBot({ callerId: CALLER_ID })
    expect(mockDb.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where:   expect.objectContaining({ botOwnerId: CALLER_ID, isBot: true, botActive: true }),
      orderBy: { createdAt: 'desc' },
    }))
    expect(r.bot.id).toBe('bot-mine')
  })

  it('returns 400 when caller has no bots at all', async () => {
    mockDb.user.findFirst.mockResolvedValueOnce(null)
    const r = await selectCallerBot({ callerId: CALLER_ID })
    expect(r.error.status).toBe(400)
    expect(r.error.message).toMatch(/Quick Bot/)
  })
})

// ─── cloneCurriculumCup happy path ──────────────────────────────────────────

describe('cloneCurriculumCup — happy path', () => {
  it('returns 201 with 4 participants (1 caller + 3 opponents)', async () => {
    const r = await cloneCurriculumCup({ callerId: CALLER_ID, myBotId: 'bot-mine' })
    expect(r.status).toBe(201)
    expect(r.body.participants).toHaveLength(4)
    expect(r.body.participants[0].isCallerBot).toBe(true)
    expect(r.body.participants.slice(1).every(p => p.isCallerBot === false)).toBe(true)
  })

  it('clones 3 opponent bot User rows (2 from Rusty, 1 from Copper)', async () => {
    await cloneCurriculumCup({ callerId: CALLER_ID, myBotId: 'bot-mine' })
    expect(mockDb.user.create).toHaveBeenCalledTimes(3)
    // Persona lookups: 2 by username 'bot-rusty', 1 by 'bot-copper'
    const rustyLookups  = mockDb.user.findUnique.mock.calls.filter(([{ where }]) => where.username === 'bot-rusty').length
    const copperLookups = mockDb.user.findUnique.mock.calls.filter(([{ where }]) => where.username === 'bot-copper').length
    expect(rustyLookups).toBe(2)
    expect(copperLookups).toBe(1)
  })

  it('opponent display names are drawn without duplicates', async () => {
    const r = await cloneCurriculumCup({ callerId: CALLER_ID, myBotId: 'bot-mine' })
    const oppNames = r.body.participants.slice(1).map(p => p.displayName)
    expect(new Set(oppNames).size).toBe(3)
  })

  it('creates the Tournament with isCup=true, deterministic seeding, IN_PROGRESS, createdById=caller', async () => {
    await cloneCurriculumCup({ callerId: CALLER_ID, myBotId: 'bot-mine' })
    expect(mockDb.tournament.create).toHaveBeenCalledTimes(1)
    const data = mockDb.tournament.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      isCup:       true,
      seedingMode: 'deterministic',
      status:      'IN_PROGRESS',
      createdById: CALLER_ID,
      bracketType: 'SINGLE_ELIM',
      bestOfN:     1,
      maxParticipants: 4,
    })
  })

  it('user bot at seedPosition=0; opponents at 1, 2, 3', async () => {
    await cloneCurriculumCup({ callerId: CALLER_ID, myBotId: 'bot-mine' })
    const seedCalls = mockDb.tournamentParticipant.create.mock.calls.map(([{ data }]) => ({
      userId:       data.userId,
      seedPosition: data.seedPosition,
    }))
    expect(seedCalls).toHaveLength(4)
    expect(seedCalls[0]).toEqual({ userId: 'bot-mine', seedPosition: 0 })
    expect(seedCalls.slice(1).map(c => c.seedPosition)).toEqual([1, 2, 3])
  })

  it('creates 1 round + 2 round-1 matches; pairing is (0v1) and (2v3)', async () => {
    await cloneCurriculumCup({ callerId: CALLER_ID, myBotId: 'bot-mine' })
    expect(mockDb.tournamentRound.create).toHaveBeenCalledTimes(1)
    expect(mockDb.tournamentMatch.create).toHaveBeenCalledTimes(2)
    const matchPairings = mockDb.tournamentMatch.create.mock.calls.map(([{ data }]) => ({
      p1: data.participant1Id,
      p2: data.participant2Id,
    }))
    expect(matchPairings[0]).toEqual({ p1: 'part-1', p2: 'part-2' })
    expect(matchPairings[1]).toEqual({ p1: 'part-3', p2: 'part-4' })
  })

  it('publishes participant:joined (step 6), 2 bot:match:ready, and tournament:started', async () => {
    await cloneCurriculumCup({ callerId: CALLER_ID, myBotId: 'bot-mine' })
    const channels = mockPublish.mock.calls.map(([ch]) => ch)
    expect(channels.filter(c => c === 'tournament:participant:joined')).toHaveLength(1)
    expect(channels.filter(c => c === 'tournament:bot:match:ready')).toHaveLength(2)
    expect(channels.filter(c => c === 'tournament:started')).toHaveLength(1)
    // step-6 publish carries userId so the bridge can credit step 6
    const joinPayload = mockPublish.mock.calls.find(([ch]) => ch === 'tournament:participant:joined')[1]
    expect(joinPayload).toEqual({ tournamentId: 'cup-1', userId: CALLER_ID })
  })

  it('uses an injectable rng for deterministic name draws', async () => {
    // Always pick first remaining → predictable sequence per pool
    const r = await cloneCurriculumCup({ callerId: CALLER_ID, myBotId: 'bot-mine', rng: () => 0 })
    const oppNames = r.body.participants.slice(1).map(p => p.displayName)
    // First two from rusty pool, then first from copper pool (in pool-declared order)
    expect(oppNames).toEqual(['Tarnished Bolt', 'Rusted Hinge', 'Copper Coil'])
  })
})

// ─── cloneCurriculumCup error paths ─────────────────────────────────────────

describe('cloneCurriculumCup — guards', () => {
  it('400 when callerId missing', async () => {
    const r = await cloneCurriculumCup({ callerId: null })
    expect(r.status).toBe(400)
  })

  it('returns selectCallerBot error verbatim', async () => {
    mockDb.user.findFirst.mockResolvedValueOnce(null)
    const r = await cloneCurriculumCup({ callerId: CALLER_ID })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/Quick Bot/)
  })

  it('throws if a built-in cup persona is missing from the seed', async () => {
    mockDb.user.findUnique.mockImplementation(({ where }) => {
      if (where.id === 'bot-mine') return Promise.resolve(CALLER_BOT)
      // simulate seed missing rusty
      return Promise.resolve(null)
    })
    await expect(cloneCurriculumCup({ callerId: CALLER_ID, myBotId: 'bot-mine' }))
      .rejects.toThrow(/persona.*missing/i)
  })
})
