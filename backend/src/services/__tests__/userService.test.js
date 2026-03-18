import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma client
vi.mock('../../lib/db.js', () => ({
  default: {
    user: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    game: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}))

const { syncUser, getUserById, updateUser, getUserStats } = await import('../userService.js')
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
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: 'usr_1' } })
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

describe('getUserStats', () => {
  beforeEach(() => {
    db.game.findMany.mockResolvedValue([])
    db.game.count.mockResolvedValue(0)
  })

  it('returns zero stats when no games played', async () => {
    db.game.findMany.mockResolvedValue([])
    const stats = await getUserStats('usr_1')
    expect(stats.totalGames).toBe(0)
    expect(stats.wins).toBe(0)
    expect(stats.winRate).toBe(0)
  })

  it('calculates win rate correctly', async () => {
    const pvpGames = [
      { outcome: 'PLAYER1_WIN', player1Id: 'usr_1', winnerId: 'usr_1' },
      { outcome: 'PLAYER2_WIN', player1Id: 'usr_1', winnerId: 'usr_2' },
      { outcome: 'DRAW', player1Id: 'usr_1', winnerId: null },
    ]
    db.game.findMany
      .mockResolvedValueOnce(pvpGames) // pvp query
      .mockResolvedValueOnce([])       // pvai query
      .mockResolvedValueOnce([])       // recent games

    const stats = await getUserStats('usr_1')
    expect(stats.totalGames).toBe(3)
    expect(stats.wins).toBe(1)
    expect(stats.draws).toBe(1)
    expect(stats.winRate).toBeCloseTo(1 / 3)
  })
})
