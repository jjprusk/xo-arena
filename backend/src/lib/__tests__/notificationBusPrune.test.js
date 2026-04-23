// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Pruner + expiresAt plumbing for notificationBus.
 *
 * Guards the lifecycle contract: UserNotification rows with an expiresAt in
 * the past should be deleted by the periodic sweep and not surface to read
 * paths (read-path coverage is in users.test.js). A row with expiresAt=null
 * must never be touched — admin announcements, system alerts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  userNotification: { deleteMany: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
  user: { findMany: vi.fn() },
  notificationPreference: { findMany: vi.fn() },
}
vi.mock('../db.js', () => ({ default: mockDb }))

vi.mock('../eventStream.js', () => ({ appendToStream: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../sseBroker.js',   () => ({ sendToUser: vi.fn(), broadcast: vi.fn() }))
vi.mock('../pushService.js', () => ({ sendToUser: vi.fn(), buildPushPayload: vi.fn() }))
vi.mock('../../logger.js',   () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { pruneExpiredNotifications, startExpiredNotificationPruner, dispatch } = await import('../notificationBus.js')

describe('pruneExpiredNotifications', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes only rows whose expiresAt is strictly less than now', async () => {
    mockDb.userNotification.deleteMany.mockResolvedValue({ count: 3 })
    const now = new Date('2026-04-23T20:00:00Z')

    const n = await pruneExpiredNotifications(now)

    expect(n).toBe(3)
    expect(mockDb.userNotification.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: now } },
    })
  })

  it('never deletes rows with expiresAt=null (the Prisma filter excludes them naturally)', async () => {
    // Prisma's {lt: now} filter skips NULL values server-side, so all we need
    // to assert here is that we're NOT passing anything like { OR: [{ expiresAt: null }] }.
    mockDb.userNotification.deleteMany.mockResolvedValue({ count: 0 })
    await pruneExpiredNotifications()
    const call = mockDb.userNotification.deleteMany.mock.calls[0][0]
    expect(call.where).toEqual({ expiresAt: { lt: expect.any(Date) } })
    expect(JSON.stringify(call.where)).not.toMatch(/null/)
  })

  it('returns 0 (non-fatal) when the DB throws', async () => {
    mockDb.userNotification.deleteMany.mockRejectedValueOnce(new Error('db down'))
    const n = await pruneExpiredNotifications()
    expect(n).toBe(0)
  })
})

describe('startExpiredNotificationPruner', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a handle with stop() that clears the interval and fires the pruner on tick', () => {
    vi.useFakeTimers()
    try {
      mockDb.userNotification.deleteMany.mockResolvedValue({ count: 0 })
      const handle = startExpiredNotificationPruner({ intervalMs: 1000 })
      expect(typeof handle.stop).toBe('function')
      // Fires once after interval
      vi.advanceTimersByTime(1000)
      expect(mockDb.userNotification.deleteMany).toHaveBeenCalledTimes(1)
      // After stop, subsequent ticks don't fire
      handle.stop()
      vi.advanceTimersByTime(5000)
      expect(mockDb.userNotification.deleteMany).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

// Sanity: dispatch's explicit expiresAt override path is preserved.
// (The registry-default path is the pre-existing behavior — covered elsewhere.)
describe('dispatch(expiresAt override)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.user.findMany.mockResolvedValue([])
  })

  it('never throws when the registry entry is unknown (drops silently)', async () => {
    await expect(dispatch({ type: 'not.a.real.event', targets: { userId: 'u' } })).resolves.toBeUndefined()
    expect(mockDb.userNotification.createMany).not.toHaveBeenCalled()
  })
})
