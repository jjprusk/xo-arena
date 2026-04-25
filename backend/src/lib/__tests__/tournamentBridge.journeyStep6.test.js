// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 4 — wiring of `tournament:participant:joined` → Curriculum step 6.
 *
 * The handler is otherwise a no-op (SSE pass-through happens in
 * tournament/redis.js). Sprint 4 adds the journey-step credit on the
 * registering user. Tests cover:
 *  - userId present → completeStep(userId, 6) called
 *  - userId missing → no journey call (defensive against older publishers)
 *  - completeStep is invoked but its result is not awaited (fire-and-forget)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  default: {
    user: { findUnique: vi.fn() },
    tournamentMatch: { findUnique: vi.fn() },
    tournamentParticipant: { findUnique: vi.fn(), findMany: vi.fn() },
    userNotification: { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  },
}))
vi.mock('../notificationBus.js', () => ({ dispatch: vi.fn().mockResolvedValue(undefined) }))
vi.mock('ioredis', () => {
  const Redis = vi.fn(() => ({ on: vi.fn(), subscribe: vi.fn() }))
  return { default: Redis }
})
vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../../services/journeyService.js', () => ({
  completeStep: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../services/discoveryRewardsService.js', () => ({
  grantDiscoveryReward: vi.fn().mockResolvedValue(undefined),
}))

import { completeStep as mockCompleteStep } from '../../services/journeyService.js'
const { handleEvent } = await import('../tournamentBridge.js')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('tournament:participant:joined → journey step 6', () => {
  it('fires completeStep(userId, 6) when userId is in the payload', async () => {
    await handleEvent(/* io */ null, 'tournament:participant:joined', { tournamentId: 'tour_1', userId: 'user-abc' })
    expect(mockCompleteStep).toHaveBeenCalledTimes(1)
    expect(mockCompleteStep).toHaveBeenCalledWith('user-abc', 6)
  })

  it('does NOT fire completeStep when userId is missing (older publisher)', async () => {
    await handleEvent(null, 'tournament:participant:joined', { tournamentId: 'tour_1' })
    expect(mockCompleteStep).not.toHaveBeenCalled()
  })

  it('does NOT fire completeStep when payload is empty', async () => {
    await handleEvent(null, 'tournament:participant:joined', undefined)
    expect(mockCompleteStep).not.toHaveBeenCalled()
  })

  it('survives a completeStep rejection (fire-and-forget)', async () => {
    mockCompleteStep.mockRejectedValueOnce(new Error('journey down'))
    await expect(
      handleEvent(null, 'tournament:participant:joined', { tournamentId: 'tour_1', userId: 'user-abc' })
    ).resolves.toBeUndefined()
  })
})
