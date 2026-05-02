import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma client
vi.mock('../../lib/db.js', () => ({
  default: {
    user: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    game: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    gameElo: {
      upsert: vi.fn(),
    },
    systemConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn(async (ops) => Array.isArray(ops) ? Promise.all(ops) : ops({})),
    $queryRaw: vi.fn(),
  },
}))

vi.mock('@xo-arena/db', () => ({
  default: {},
  db: {},
  Prisma: {
    sql: (strings, ...values) => ({ strings, values }),
    empty: { strings: [''], values: [] },
  },
}))

const { syncUser, getUserById, updateUser, getUserStats, getBotByModelId, resetBotElo, getLeaderboard, createBot } =
  await import('../userService.js')
const db = (await import('../../lib/db.js')).default

const mockUser = {
  id: 'usr_1',
  clerkId: 'clerk_1',
  email: 'test@example.com',
  username: 'testuser',
  displayName: 'Test User',
  avatarUrl: null,
  preferences: {},
  createdAt: new Date(),
}

const mockBot = {
  id: 'bot_1',
  isBot: true,
  botModelId: 'builtin:minimax:novice',
  displayName: 'Rusty',
  botActive: true,
  eloRating: 1200,
}

describe('syncUser', () => {
  it('calls upsert with correct data', async () => {
    db.user.upsert.mockResolvedValue(mockUser)
    const result = await syncUser({
      clerkId: 'clerk_1',
      email: 'test@example.com',
      username: 'testuser',
      displayName: 'Test User',
    })
    expect(db.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clerkId: 'clerk_1' } })
    )
    expect(result).toEqual(mockUser)
  })
})

describe('getUserById', () => {
  it('returns user when found', async () => {
    db.user.findUnique.mockResolvedValue(mockUser)
    const result = await getUserById('usr_1')
    expect(result).toEqual(mockUser)
    expect(db.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'usr_1' } })
    )
  })

  it('returns null when not found', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const result = await getUserById('nonexistent')
    expect(result).toBeNull()
  })
})

describe('updateUser', () => {
  it('calls update with partial fields', async () => {
    const updated = { ...mockUser, displayName: 'New Name' }
    db.user.update.mockResolvedValue(updated)
    const result = await updateUser('usr_1', { displayName: 'New Name' })
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'usr_1' },
        data: expect.objectContaining({ displayName: 'New Name' }),
      })
    )
    expect(result.displayName).toBe('New Name')
  })

  it('does not include undefined fields', async () => {
    db.user.update.mockResolvedValue(mockUser)
    await updateUser('usr_1', { displayName: undefined, avatarUrl: 'img.png' })
    const call = db.user.update.mock.calls.at(-1)[0]
    expect(call.data).not.toHaveProperty('displayName')
    expect(call.data.avatarUrl).toBe('img.png')
  })
})

describe('getBotByModelId', () => {
  it('returns bot when found', async () => {
    db.user.findFirst.mockResolvedValue(mockBot)
    const result = await getBotByModelId('builtin:minimax:novice')
    expect(result).toEqual(mockBot)
    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: { botModelId: 'builtin:minimax:novice', isBot: true },
    })
  })

  it('returns null when bot not found', async () => {
    db.user.findFirst.mockResolvedValue(null)
    const result = await getBotByModelId('builtin:minimax:unknown')
    expect(result).toBeNull()
  })
})

describe('resetBotElo', () => {
  it('resets ELO to 1200 and sets botProvisional + botEloResetAt', async () => {
    const updated = { ...mockBot, botProvisional: true, botEloResetAt: new Date() }
    db.gameElo.upsert.mockResolvedValue({ rating: 1200, gamesPlayed: 0 })
    db.user.update.mockResolvedValue(updated)

    await resetBotElo('bot_1')

    expect(db.gameElo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ rating: 1200, gamesPlayed: 0 }),
      })
    )
    const call = db.user.update.mock.calls.at(-1)[0]
    expect(call.where).toEqual({ id: 'bot_1' })
    expect(call.data.botProvisional).toBe(true)
    expect(call.data.botEloResetAt).toBeInstanceOf(Date)
  })
})

describe('getUserStats', () => {
  beforeEach(() => {
    db.game.findMany.mockResolvedValue([])
  })

  it('returns zero stats when no games played', async () => {
    // hvh, hva, hvb, recent — all empty
    db.game.findMany.mockResolvedValue([])
    const stats = await getUserStats('usr_1')
    expect(stats.totalGames).toBe(0)
    expect(stats.wins).toBe(0)
    expect(stats.winRate).toBe(0)
    expect(stats.hvb.played).toBe(0)
  })

  it('calculates win rate correctly from pvp games', async () => {
    const pvpGames = [
      { outcome: 'PLAYER1_WIN', player1Id: 'usr_1', winnerId: 'usr_1' },
      { outcome: 'PLAYER2_WIN', player1Id: 'usr_1', winnerId: 'usr_2' },
      { outcome: 'DRAW', player1Id: 'usr_1', winnerId: null },
    ]
    db.game.findMany
      .mockResolvedValueOnce(pvpGames) 
      .mockResolvedValueOnce([])       
      .mockResolvedValueOnce([])       
      .mockResolvedValueOnce([])       // recent

    const stats = await getUserStats('usr_1')
    expect(stats.totalGames).toBe(3)
    expect(stats.wins).toBe(1)
    expect(stats.draws).toBe(1)
    expect(stats.winRate).toBeCloseTo(1 / 3)
  })

  it('includes pvbot games in totals', async () => {
    const pvbotGames = [
      { outcome: 'PLAYER1_WIN', winnerId: 'usr_1', player2Id: 'bot_1', player2: { id: 'bot_1', displayName: 'Rusty', avatarUrl: null } },
      { outcome: 'PLAYER2_WIN', winnerId: 'bot_1', player2Id: 'bot_1', player2: { id: 'bot_1', displayName: 'Rusty', avatarUrl: null } },
    ]
    db.game.findMany
      .mockResolvedValueOnce([])       
      .mockResolvedValueOnce([])       
      .mockResolvedValueOnce(pvbotGames) 
      .mockResolvedValueOnce([])       // recent

    const stats = await getUserStats('usr_1')
    expect(stats.totalGames).toBe(2)
    expect(stats.hvb.played).toBe(2)
    expect(stats.hvb.wins).toBe(1)
    expect(stats.hvb.rate).toBe(0.5)
    expect(stats.hvb.byBot['bot_1'].played).toBe(2)
  })

  it('groups pvbot stats by opponent bot', async () => {
    const pvbotGames = [
      { outcome: 'PLAYER1_WIN', winnerId: 'usr_1', player2Id: 'bot_1', player2: { id: 'bot_1', displayName: 'Rusty', avatarUrl: null } },
      { outcome: 'PLAYER1_WIN', winnerId: 'usr_1', player2Id: 'bot_2', player2: { id: 'bot_2', displayName: 'Magnus', avatarUrl: null } },
      { outcome: 'PLAYER2_WIN', winnerId: 'bot_2', player2Id: 'bot_2', player2: { id: 'bot_2', displayName: 'Magnus', avatarUrl: null } },
    ]
    db.game.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(pvbotGames)
      .mockResolvedValueOnce([])

    const stats = await getUserStats('usr_1')
    expect(Object.keys(stats.hvb.byBot)).toHaveLength(2)
    expect(stats.hvb.byBot['bot_1'].wins).toBe(1)
    expect(stats.hvb.byBot['bot_2'].wins).toBe(1)
    expect(stats.hvb.byBot['bot_2'].played).toBe(2)
    expect(stats.hvb.byBot['bot_2'].rate).toBe(0.5)
  })
})

describe('getLeaderboard', () => {
  it('maps raw SQL rows to the expected leaderboard shape', async () => {
    db.$queryRaw.mockResolvedValue([
      { id: 'u1', displayName: 'Alice', avatarUrl: null, isBot: false, total: 20n, wins: 16n, win_rate: '0.8000' },
      { id: 'u2', displayName: 'Bob',   avatarUrl: null, isBot: false, total: 15n, wins:  9n, win_rate: '0.6000' },
    ])

    const result = await getLeaderboard()

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      rank: 1,
      user: { id: 'u1', displayName: 'Alice', avatarUrl: null, isBot: false },
      total: 20,
      wins: 16,
      winRate: 0.8,
    })
    expect(result[1].rank).toBe(2)
    expect(result[1].user.displayName).toBe('Bob')
  })

  it('returns number types (not BigInt) for total, wins, winRate', async () => {
    db.$queryRaw.mockResolvedValue([
      { id: 'u1', displayName: 'Alice', avatarUrl: null, isBot: false, total: 10n, wins: 5n, win_rate: '0.5000' },
    ])

    const [entry] = await getLeaderboard()
    expect(typeof entry.total).toBe('number')
    expect(typeof entry.wins).toBe('number')
    expect(typeof entry.winRate).toBe('number')
  })

  it('returns empty array when no rows', async () => {
    db.$queryRaw.mockResolvedValue([])
    const result = await getLeaderboard()
    expect(result).toEqual([])
  })
})

// ─── createBot — Phase 3.8 skill-less path ───────────────────────────────────
//
// The Multi-Skill Bots reshape splits bot creation from skill creation. When
// `createBot` is called with no `algorithm`, it must produce a User row that
// is a valid identity (isBot=true, owned by ownerId, name validated and
// deduped) but carries NO model pointer (botModelId=null, botModelType=null)
// and triggers NO BotSkill or GameElo writes — those happen later via the
// /bots/:id/skills endpoint. Critical regression guard: an earlier draft
// silently fell into the legacy minimax default when `algorithm` was
// omitted, so a v1.28 client speaking the new skill-less body produced
// minimax-bound bots and broke 3.8's whole "identity ≠ skill" decision.
describe('createBot — Phase 3.8 skill-less', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Name dedup query returns no existing bots by default.
    db.user.findMany.mockResolvedValue([])
  })

  it('skill-less call: creates bot with botModelId=null and botModelType=null', async () => {
    db.user.create.mockImplementation(async ({ data }) => ({ id: 'bot_new', ...data }))

    const bot = await createBot('owner_1', { name: 'Skillless', avatarUrl: null, competitive: true })

    expect(db.user.create).toHaveBeenCalledTimes(1)
    const data = db.user.create.mock.calls[0][0].data
    expect(data).toEqual(expect.objectContaining({
      displayName:    'Skillless',
      isBot:          true,
      botModelType:   null,
      botModelId:     null,
      botOwnerId:     'owner_1',
      botActive:      true,
      botCompetitive: true,
      botProvisional: true,
    }))
    // Must NOT touch skills / ELO during identity-only create:
    expect(bot.botModelType).toBeNull()
    expect(bot.botModelId).toBeNull()
  })

  it('skill-less call honors competitive=false (default off if undefined)', async () => {
    db.user.create.mockImplementation(async ({ data }) => ({ id: 'b1', ...data }))

    await createBot('owner_1', { name: 'NotCompetitive' })
    expect(db.user.create.mock.calls[0][0].data.botCompetitive).toBe(false)

    db.user.create.mockClear()
    await createBot('owner_2', { name: 'StillNot', competitive: false })
    expect(db.user.create.mock.calls[0][0].data.botCompetitive).toBe(false)
  })

  it('skill-less call still rejects reserved + duplicate names', async () => {
    await expect(createBot('owner_1', { name: 'rusty' }))
      .rejects.toMatchObject({ code: 'RESERVED_NAME' })

    db.user.findMany.mockResolvedValueOnce([{ displayName: 'Taken' }])
    await expect(createBot('owner_1', { name: 'Taken' }))
      .rejects.toMatchObject({ code: 'NAME_TAKEN' })
  })

  it('legacy path (algorithm=minimax) still creates bot with synthetic botModelId — Quick Bot wizard regression guard', async () => {
    db.user.create.mockImplementation(async ({ data }) => ({ id: 'b1', ...data }))

    const bot = await createBot('owner_1', { name: 'QuickBot', algorithm: 'minimax', difficulty: 'novice' })

    const data = db.user.create.mock.calls[0][0].data
    expect(data.botModelType).toBe('minimax')
    expect(data.botModelId).toBe('user:owner_1:minimax:novice')
    expect(bot.botModelId).toBe('user:owner_1:minimax:novice')
  })
})
