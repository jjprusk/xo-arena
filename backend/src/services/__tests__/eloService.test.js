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

const { updatePlayerEloAfterPvAI, updateBothElosAfterPvBot, updatePlayersEloAfterPvP } =
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
