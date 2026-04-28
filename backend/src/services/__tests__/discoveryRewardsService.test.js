// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/db.js', () => ({
  default: {
    user:         { findUnique: vi.fn(), update: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
  },
}))
vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { mockAppendToStream } = vi.hoisted(() => ({
  mockAppendToStream: vi.fn().mockResolvedValue('1-0'),
}))
vi.mock('../../lib/eventStream.js', () => ({ appendToStream: mockAppendToStream }))

import db from '../../lib/db.js'
import {
  DISCOVERY_REWARDS,
  DISCOVERY_REWARD_KEYS,
  getGrantedRewards,
  grantDiscoveryReward,
} from '../discoveryRewardsService.js'

const userId = 'user_1'

function mockUser({ granted = [], extra = {} } = {}) {
  return {
    id:          userId,
    preferences: {
      discoveryRewardsGranted: [...granted],
      ...extra,
    },
  }
}

function mockIo() {
  const roomEmit = vi.fn()
  const to = vi.fn().mockReturnValue({ emit: roomEmit })
  return { to, roomEmit }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.systemConfig.findUnique.mockResolvedValue(null)
  db.user.update.mockResolvedValue({})
})

// ── Module surface ────────────────────────────────────────────────────────────

describe('discoveryRewardsService — module surface', () => {
  it('exposes the four v1 reward keys (canonical names per requirements §8.4)', () => {
    expect(DISCOVERY_REWARD_KEYS).toEqual([
      'firstSpecializeAction',
      'firstRealTournamentWin',
      'firstNonDefaultAlgorithm',
      'firstTemplateClone',
    ])
  })

  it('every reward has a positive default TC and a title/body', () => {
    for (const key of DISCOVERY_REWARD_KEYS) {
      const r = DISCOVERY_REWARDS[key]
      expect(r.defaultTc).toBeGreaterThan(0)
      expect(typeof r.title).toBe('string')
      expect(typeof r.body).toBe('string')
    }
  })
})

// ── getGrantedRewards ────────────────────────────────────────────────────────

describe('getGrantedRewards', () => {
  it('returns empty array when user not found', async () => {
    db.user.findUnique.mockResolvedValue(null)
    expect(await getGrantedRewards(userId)).toEqual([])
  })

  it('returns empty array when user has no preferences', async () => {
    db.user.findUnique.mockResolvedValue({ id: userId, preferences: null })
    expect(await getGrantedRewards(userId)).toEqual([])
  })

  it('returns the stored array when present', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ granted: ['firstRealTournamentWin'] }))
    expect(await getGrantedRewards(userId)).toEqual(['firstRealTournamentWin'])
  })

  it('returns empty array when discoveryRewardsGranted is not an array', async () => {
    db.user.findUnique.mockResolvedValue({
      id: userId, preferences: { discoveryRewardsGranted: 'not-an-array' },
    })
    expect(await getGrantedRewards(userId)).toEqual([])
  })
})

// ── grantDiscoveryReward — happy paths ────────────────────────────────────────

describe('grantDiscoveryReward — happy path', () => {
  it.each(DISCOVERY_REWARD_KEYS)('grants %s with default TC when no prior grant', async (key) => {
    db.user.findUnique.mockResolvedValue(mockUser({ granted: [] }))

    const result = await grantDiscoveryReward(userId, key)

    expect(result).toBe(true)
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: userId },
        data:  expect.objectContaining({
          creditsTc: { increment: DISCOVERY_REWARDS[key].defaultTc },
          preferences: expect.objectContaining({
            discoveryRewardsGranted: [key],
          }),
        }),
      })
    )
  })

  it('preserves other preference keys when updating', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({
      granted: [],
      extra:   { journeyProgress: { completedSteps: [1, 2], dismissedAt: null } },
    }))

    await grantDiscoveryReward(userId, 'firstTemplateClone')

    const args = db.user.update.mock.calls[0][0]
    expect(args.data.preferences.journeyProgress).toEqual({
      completedSteps: [1, 2], dismissedAt: null,
    })
  })

  it('appends to an existing discoveryRewardsGranted array', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ granted: ['firstRealTournamentWin'] }))

    await grantDiscoveryReward(userId, 'firstTemplateClone')

    const args = db.user.update.mock.calls[0][0]
    expect(args.data.preferences.discoveryRewardsGranted).toEqual([
      'firstRealTournamentWin', 'firstTemplateClone',
    ])
  })

  it('uses admin-configured reward amount when SystemConfig key is set', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ granted: [] }))
    db.systemConfig.findUnique.mockImplementation(async ({ where: { key } }) => {
      if (key === 'guide.rewards.discovery.firstRealTournamentWin') return { value: '40' }
      return null
    })

    await grantDiscoveryReward(userId, 'firstRealTournamentWin')

    const args = db.user.update.mock.calls[0][0]
    expect(args.data.creditsTc).toEqual({ increment: 40 })
  })

  it('appends guide:discovery_reward to the SSE stream', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ granted: [] }))
    mockAppendToStream.mockClear()

    await grantDiscoveryReward(userId, 'firstTemplateClone')

    const sseCall = mockAppendToStream.mock.calls.find(([ch]) => ch === 'guide:discovery_reward')
    expect(sseCall).toBeDefined()
    expect(sseCall[1]).toMatchObject({
      rewardKey: 'firstTemplateClone',
      reward:    DISCOVERY_REWARDS.firstTemplateClone.defaultTc,
    })
    expect(sseCall[2]).toEqual({ userId })
  })
})

// ── Idempotency ──────────────────────────────────────────────────────────────

describe('grantDiscoveryReward — idempotency', () => {
  it('returns false and skips writes when reward already granted', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ granted: ['firstRealTournamentWin'] }))

    const result = await grantDiscoveryReward(userId, 'firstRealTournamentWin')

    expect(result).toBe(false)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('does not emit any socket event when already granted', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ granted: ['firstRealTournamentWin'] }))
    const io = mockIo()

    await grantDiscoveryReward(userId, 'firstRealTournamentWin', io)

    expect(io.roomEmit).not.toHaveBeenCalled()
  })
})

// ── Defensive paths ───────────────────────────────────────────────────────────

describe('grantDiscoveryReward — defensive paths', () => {
  it('returns false for unknown reward key', async () => {
    const result = await grantDiscoveryReward(userId, 'notARealReward')
    expect(result).toBe(false)
    expect(db.user.findUnique).not.toHaveBeenCalled()
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('returns false when user not found', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const result = await grantDiscoveryReward(userId, 'firstRealTournamentWin')
    expect(result).toBe(false)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('returns false (does not throw) when DB update fails', async () => {
    db.user.findUnique.mockResolvedValue(mockUser({ granted: [] }))
    db.user.update.mockRejectedValue(new Error('DB offline'))

    const result = await grantDiscoveryReward(userId, 'firstTemplateClone')
    expect(result).toBe(false)
  })

  it('treats missing preferences as empty granted list (first-ever grant)', async () => {
    db.user.findUnique.mockResolvedValue({ id: userId, preferences: null })

    const result = await grantDiscoveryReward(userId, 'firstTemplateClone')

    expect(result).toBe(true)
    const args = db.user.update.mock.calls[0][0]
    expect(args.data.preferences.discoveryRewardsGranted).toEqual(['firstTemplateClone'])
  })
})
