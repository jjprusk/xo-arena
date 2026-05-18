import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/db.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    gameElo: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    userEloHistory: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (ops) => Promise.all(ops)),
  },
}))

vi.mock('../skillService.js', () => ({
  getSystemConfig: vi.fn().mockResolvedValue(5),
}))

const { updatePlayerEloAfterPvAI, updateBothElosAfterPvBot, updateBothElosAfterBotVsBot, updatePlayersEloAfterPvP } =
  await import('../eloService.js')
const db = (await import('../../lib/db.js')).default

beforeEach(() => {
  vi.clearAllMocks()
  db.user.update.mockResolvedValue({})
  db.gameElo.findUnique.mockResolvedValue({ rating: 1200 })
  db.gameElo.upsert.mockResolvedValue({})
  db.userEloHistory.create.mockResolvedValue({})
  db.$transaction.mockImplementation(async (ops) => Promise.all(ops))
})

describe('updatePlayerEloAfterPvAI', () => {
  it('increases ELO on win vs novice', async () => {
    db.gameElo.findUnique.mockResolvedValue({ rating: 1200 })
    const result = await updatePlayerEloAfterPvAI('usr_1', 'PLAYER1_WIN', 'novice')
    expect(result.delta).toBeGreaterThan(0)
  })

  it('decreases ELO on loss vs master', async () => {
    db.gameElo.findUnique.mockResolvedValue({ rating: 1200 })
    const result = await updatePlayerEloAfterPvAI('usr_1', 'AI_WIN', 'master')
    expect(result.delta).toBeLessThan(0)
  })

  it('records opponentType correctly', async () => {
    db.gameElo.findUnique.mockResolvedValue({ rating: 1200 })
    await updatePlayerEloAfterPvAI('usr_1', 'DRAW', 'intermediate')
    const historyCreate = db.userEloHistory.create.mock.calls[0][0]
    expect(historyCreate.data.opponentType).toBe('ai_intermediate')
    expect(historyCreate.data.outcome).toBe('draw')
  })

  it('does not throw when db errors — returns undefined', async () => {
    db.gameElo.findUnique.mockRejectedValue(new Error('db down'))
    const result = await updatePlayerEloAfterPvAI('usr_1', 'PLAYER1_WIN', 'novice')
    expect(result).toBeUndefined()
  })
})

describe('updateBothElosAfterPvBot', () => {
  const mockBotData = { botGamesPlayed: 0, botProvisional: true }

  it('updates both human and bot ELO on human win', async () => {
    db.gameElo.findUnique.mockResolvedValue({ rating: 1200 })
    db.user.findUnique.mockResolvedValue(mockBotData)

    const result = await updateBothElosAfterPvBot('usr_1', 'bot_1', 'PLAYER1_WIN')
    expect(result.human.delta).toBeGreaterThan(0)
    expect(result.bot.delta).toBeLessThan(0)
  })

  it('updates both ELO on bot win', async () => {
    db.gameElo.findUnique.mockResolvedValue({ rating: 1200 })
    db.user.findUnique.mockResolvedValue(mockBotData)

    const result = await updateBothElosAfterPvBot('usr_1', 'bot_1', 'PLAYER2_WIN')
    expect(result.human.delta).toBeLessThan(0)
    expect(result.bot.delta).toBeGreaterThan(0)
  })

  it('writes history for both sides', async () => {
    db.gameElo.findUnique.mockResolvedValue({ rating: 1200 })
    db.user.findUnique.mockResolvedValue(mockBotData)

    await updateBothElosAfterPvBot('usr_1', 'bot_1', 'DRAW')
    expect(db.userEloHistory.create).toHaveBeenCalledTimes(2)

    const calls = db.userEloHistory.create.mock.calls
    const humanCall = calls.find((c) => c[0].data.userId === 'usr_1')
    const botCall = calls.find((c) => c[0].data.userId === 'bot_1')

    expect(humanCall[0].data.opponentType).toBe('bot')
    expect(humanCall[0].data.outcome).toBe('draw')
    expect(botCall[0].data.opponentType).toBe('human')
    expect(botCall[0].data.outcome).toBe('draw')
  })

  it('does not throw on db error', async () => {
    db.gameElo.findUnique.mockRejectedValue(new Error('db down'))
    const result = await updateBothElosAfterPvBot('usr_1', 'bot_1', 'PLAYER1_WIN')
    expect(result).toBeUndefined()
  })

  it('ELO delta magnitude is symmetric for equal-rated players', async () => {
    db.gameElo.findUnique.mockResolvedValue({ rating: 1200 })
    db.user.findUnique.mockResolvedValue(mockBotData)

    const result = await updateBothElosAfterPvBot('usr_1', 'bot_1', 'PLAYER1_WIN')
    expect(Math.abs(result.human.delta)).toBeCloseTo(Math.abs(result.bot.delta), 1)
  })
})

describe('updatePlayersEloAfterPvP', () => {
  it('increases winner ELO and decreases loser ELO', async () => {
    db.gameElo.findUnique.mockResolvedValue({ rating: 1200 })

    const result = await updatePlayersEloAfterPvP('usr_1', 'usr_2', 'PLAYER1_WIN')
    expect(result.player1.delta).toBeGreaterThan(0)
    expect(result.player2.delta).toBeLessThan(0)
  })

  it('does not throw on db error', async () => {
    db.gameElo.findUnique.mockRejectedValue(new Error('db down'))
    const result = await updatePlayersEloAfterPvP('usr_1', 'usr_2', 'PLAYER1_WIN')
    expect(result).toBeUndefined()
  })
})

describe('options.gameId — multi-game parameterization', () => {
  it('threads custom gameId through GameElo lookup + upsert', async () => {
    db.gameElo.findUnique.mockResolvedValue({ rating: 1200 })

    await updatePlayerEloAfterPvAI('usr_1', 'PLAYER1_WIN', 'novice', { gameId: 'connect-four' })

    expect(db.gameElo.findUnique).toHaveBeenCalledWith({
      where: { userId_gameId: { userId: 'usr_1', gameId: 'connect-four' } },
    })
    expect(db.gameElo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where:  { userId_gameId: { userId: 'usr_1', gameId: 'connect-four' } },
      create: expect.objectContaining({ gameId: 'connect-four' }),
    }))
  })

  it('defaults gameId to the canonical TTT slug when omitted', async () => {
    db.gameElo.findUnique.mockResolvedValue({ rating: 1200 })

    await updatePlayerEloAfterPvAI('usr_1', 'DRAW', 'intermediate')

    expect(db.gameElo.findUnique).toHaveBeenCalledWith({
      where: { userId_gameId: { userId: 'usr_1', gameId: 'tic-tac-toe' } },
    })
  })

  it('threads gameId through both sides of PvBot', async () => {
    db.gameElo.findUnique.mockResolvedValue({ rating: 1200 })
    db.user.findUnique.mockResolvedValue({ botGamesPlayed: 0, botProvisional: true })

    await updateBothElosAfterPvBot('usr_1', 'bot_1', 'PLAYER1_WIN', { gameId: 'connect-four' })

    const eloLookups = db.gameElo.findUnique.mock.calls.map(c => c[0].where.userId_gameId.gameId)
    expect(eloLookups.every(g => g === 'connect-four')).toBe(true)
    const upserts = db.gameElo.upsert.mock.calls.map(c => c[0].where.userId_gameId.gameId)
    expect(upserts).toEqual(['connect-four', 'connect-four'])
  })
})

describe('options.offLadder — skip ELO update', () => {
  it('returns skipped:true and does NOT touch the DB on PvAI', async () => {
    const result = await updatePlayerEloAfterPvAI('usr_1', 'AI_WIN', 'master', { offLadder: true })

    expect(result).toEqual({ newElo: null, delta: 0, skipped: true })
    expect(db.gameElo.findUnique).not.toHaveBeenCalled()
    expect(db.gameElo.upsert).not.toHaveBeenCalled()
    expect(db.userEloHistory.create).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('returns skipped:true on PvBot — no DB writes for either side', async () => {
    const result = await updateBothElosAfterPvBot('usr_1', 'bot_1', 'PLAYER1_WIN', { offLadder: true })

    expect(result.skipped).toBe(true)
    expect(result.human).toEqual({ newElo: null, delta: 0 })
    expect(result.bot).toEqual({ newElo: null, delta: 0 })
    expect(db.gameElo.findUnique).not.toHaveBeenCalled()
    expect(db.gameElo.upsert).not.toHaveBeenCalled()
    expect(db.userEloHistory.create).not.toHaveBeenCalled()
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('returns skipped:true on BotVsBot — bot stats untouched', async () => {
    const result = await updateBothElosAfterBotVsBot('bot_1', 'bot_2', 'PLAYER1_WIN', { offLadder: true })

    expect(result.skipped).toBe(true)
    expect(result.bot1).toEqual({ newElo: null, delta: 0 })
    expect(result.bot2).toEqual({ newElo: null, delta: 0 })
    expect(db.gameElo.findUnique).not.toHaveBeenCalled()
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('returns skipped:true on PvP — both players left intact', async () => {
    const result = await updatePlayersEloAfterPvP('usr_1', 'usr_2', 'PLAYER1_WIN', { offLadder: true })

    expect(result.skipped).toBe(true)
    expect(result.player1).toEqual({ newElo: null, delta: 0 })
    expect(result.player2).toEqual({ newElo: null, delta: 0 })
    expect(db.gameElo.findUnique).not.toHaveBeenCalled()
    expect(db.userEloHistory.create).not.toHaveBeenCalled()
  })

  it('offLadder:false (or omitted) takes the normal ELO path', async () => {
    db.gameElo.findUnique.mockResolvedValue({ rating: 1200 })

    const r1 = await updatePlayerEloAfterPvAI('usr_1', 'PLAYER1_WIN', 'novice')
    expect(r1.skipped).toBeUndefined()
    expect(r1.delta).toBeGreaterThan(0)

    db.user.findUnique.mockResolvedValue({ botGamesPlayed: 0, botProvisional: true })
    const r2 = await updateBothElosAfterPvBot('usr_1', 'bot_1', 'PLAYER1_WIN', { offLadder: false })
    expect(r2.skipped).toBeUndefined()
    expect(r2.human.delta).toBeGreaterThan(0)
  })
})
