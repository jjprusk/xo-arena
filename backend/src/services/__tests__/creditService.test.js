import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/db.js', () => ({
  default: {
    user: { findUnique: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
  },
}))

const { getUserCredits, getTierForScore, getTierLimit } = await import('../creditService.js')
const db = (await import('../../lib/db.js')).default

function mockUser(overrides = {}) {
  return {
    creditsHpc: 0,
    creditsBpc: 0,
    creditsTc: 0,
    botLimit: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // No system config rows by default → all defaults apply
  db.systemConfig.findUnique.mockResolvedValue(null)
})

// ---------------------------------------------------------------------------
// getTierForScore
// ---------------------------------------------------------------------------

describe('getTierForScore', () => {
  it('returns 0 (Bronze) for score 0', async () => {
    expect(await getTierForScore(0)).toBe(0)
  })

  it('returns 0 (Bronze) for score 24', async () => {
    expect(await getTierForScore(24)).toBe(0)
  })

  it('returns 1 (Silver) for score 25', async () => {
    expect(await getTierForScore(25)).toBe(1)
  })

  it('returns 1 (Silver) for score 99', async () => {
    expect(await getTierForScore(99)).toBe(1)
  })

  it('returns 2 (Gold) for score 100', async () => {
    expect(await getTierForScore(100)).toBe(2)
  })

  it('returns 2 (Gold) for score 499', async () => {
    expect(await getTierForScore(499)).toBe(2)
  })

  it('returns 3 (Platinum) for score 500', async () => {
    expect(await getTierForScore(500)).toBe(3)
  })

  it('returns 3 (Platinum) for score 1999', async () => {
    expect(await getTierForScore(1999)).toBe(3)
  })

  it('returns 4 (Diamond) for score 2000', async () => {
    expect(await getTierForScore(2000)).toBe(4)
  })

  it('returns 4 (Diamond) for score 99999', async () => {
    expect(await getTierForScore(99999)).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// getUserCredits — shape and formula
// ---------------------------------------------------------------------------

describe('getUserCredits', () => {
  it('returns correct shape for a new user', async () => {
    db.user.findUnique.mockResolvedValue(mockUser())
    const result = await getUserCredits('usr_1')
    expect(result).toEqual({
      hpc: 0, bpc: 0, tc: 0,
      activityScore: 0,
      tier: 0, tierName: 'Bronze', tierIcon: '🥉',
      nextTier: 1, pointsToNextTier: 25,
    })
  })

  it('applies tcMultiplier=5 by default', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ creditsHpc: 15, creditsBpc: 30, creditsTc: 10 }))
    const result = await getUserCredits('usr_1')
    // 15 + 30 + (10 * 5) = 95
    expect(result.activityScore).toBe(95)
    expect(result.tier).toBe(1) // Silver (25–99)
    expect(result.tierName).toBe('Silver')
    expect(result.tierIcon).toBe('🥈')
    expect(result.nextTier).toBe(2)
    expect(result.pointsToNextTier).toBe(5) // 100 - 95
  })

  it('applies custom tcMultiplier from system config', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ creditsTc: 10 }))
    db.systemConfig.findUnique.mockImplementation(({ where: { key } }) => {
      if (key === 'credits.tcMultiplier') return Promise.resolve({ key, value: '10' })
      return Promise.resolve(null)
    })
    const result = await getUserCredits('usr_1')
    // 0 + 0 + (10 * 10) = 100
    expect(result.activityScore).toBe(100)
    expect(result.tier).toBe(2) // Gold
  })

  it('returns Diamond tier with nextTier=null and pointsToNextTier=null', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ creditsHpc: 2000 }))
    const result = await getUserCredits('usr_1')
    expect(result.tier).toBe(4)
    expect(result.tierName).toBe('Diamond')
    expect(result.tierIcon).toBe('💎')
    expect(result.nextTier).toBeNull()
    expect(result.pointsToNextTier).toBeNull()
  })

  it('throws if user not found', async () => {
    db.user.findUnique.mockResolvedValue(null)
    await expect(getUserCredits('missing')).rejects.toThrow('User not found: missing')
  })

  it('reaches Gold tier at exactly score 100', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ creditsHpc: 100 }))
    const result = await getUserCredits('usr_1')
    expect(result.tier).toBe(2)
    expect(result.tierName).toBe('Gold')
  })

  it('reaches Platinum at exactly score 500', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ creditsHpc: 500 }))
    const result = await getUserCredits('usr_1')
    expect(result.tier).toBe(3)
    expect(result.tierName).toBe('Platinum')
    expect(result.tierIcon).toBe('💠')
  })
})

// ---------------------------------------------------------------------------
// getTierLimit — bots capability
// ---------------------------------------------------------------------------

describe('getTierLimit — bots', () => {
  it('returns per-user botLimit override when set', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ botLimit: 20 }))
    expect(await getTierLimit('usr_1', 'bots')).toBe(20)
  })

  it('returns 0 (unlimited) when botLimit override is 0', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ botLimit: 0 }))
    expect(await getTierLimit('usr_1', 'bots')).toBe(0)
  })

  it('returns tier default for Bronze (3) when no override', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ creditsHpc: 0 }))
    expect(await getTierLimit('usr_1', 'bots')).toBe(3)
  })

  it('returns tier default for Silver (5) when no override', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ creditsHpc: 25 }))
    expect(await getTierLimit('usr_1', 'bots')).toBe(5)
  })

  it('returns tier default for Gold (8) when no override', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ creditsHpc: 100 }))
    expect(await getTierLimit('usr_1', 'bots')).toBe(8)
  })

  it('returns tier default for Platinum (15) when no override', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ creditsHpc: 500 }))
    expect(await getTierLimit('usr_1', 'bots')).toBe(15)
  })

  it('returns tier default for Diamond (0) when no override', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ creditsHpc: 2000 }))
    expect(await getTierLimit('usr_1', 'bots')).toBe(0)
  })

  it('uses system config override for bot limit', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ creditsHpc: 100 })) // Gold
    db.systemConfig.findUnique.mockImplementation(({ where: { key } }) => {
      if (key === 'credits.limits.bots.gold') return Promise.resolve({ key, value: '12' })
      return Promise.resolve(null)
    })
    expect(await getTierLimit('usr_1', 'bots')).toBe(12)
  })
})

// ---------------------------------------------------------------------------
// getTierLimit — episodesPerSession capability
// ---------------------------------------------------------------------------

describe('getTierLimit — episodesPerSession', () => {
  it('returns 1000 for Bronze', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ creditsHpc: 0 }))
    expect(await getTierLimit('usr_1', 'episodesPerSession')).toBe(1000)
  })

  it('returns 5000 for Silver', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ creditsHpc: 25 }))
    expect(await getTierLimit('usr_1', 'episodesPerSession')).toBe(5000)
  })

  it('returns 20000 for Gold', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ creditsHpc: 100 }))
    expect(await getTierLimit('usr_1', 'episodesPerSession')).toBe(20000)
  })

  it('returns 50000 for Platinum', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ creditsHpc: 500 }))
    expect(await getTierLimit('usr_1', 'episodesPerSession')).toBe(50000)
  })

  it('returns 100000 for Diamond', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ creditsHpc: 2000 }))
    expect(await getTierLimit('usr_1', 'episodesPerSession')).toBe(100000)
  })
})

// ---------------------------------------------------------------------------
// getTierLimit — unknown capability
// ---------------------------------------------------------------------------

describe('getTierLimit — unknown capability', () => {
  it('throws for unknown capability', async () => {
    db.user.findUnique.mockResolvedValue(mockUser())
    await expect(getTierLimit('usr_1', 'unknown')).rejects.toThrow('Unknown capability: unknown')
  })
})
