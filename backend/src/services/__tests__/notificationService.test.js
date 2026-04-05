import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/db.js', () => ({
  default: {
    user: { findUnique: vi.fn() },
    baSession: { findFirst: vi.fn() },
    userNotification: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    systemConfig: { findUnique: vi.fn() },
  },
}))

vi.mock('../../services/creditService.js', () => ({
  getUserCredits: vi.fn(),
  getTierLimit: vi.fn(),
}))

vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: { send: vi.fn().mockResolvedValue({ id: 'email_1' }) },
  })),
}))

process.env.RESEND_API_KEY = 'test-key'

const { queueNotification, checkAndNotify } = await import('../notificationService.js')
const db = (await import('../../lib/db.js')).default
const { getUserCredits, getTierLimit } = await import('../../services/creditService.js')
const { Resend } = await import('resend')
const emailSend = Resend.mock.results[0]?.value?.emails?.send

beforeEach(() => {
  vi.clearAllMocks()
  db.systemConfig.findUnique.mockResolvedValue(null)
  db.userNotification.findFirst.mockResolvedValue(null)
  db.userNotification.create.mockResolvedValue({ id: 'notif_1', userId: 'usr_1', type: 'first_hpc', payload: {}, createdAt: new Date() })
  db.userNotification.update.mockResolvedValue({})
})

function mockUserOnline(betterAuthId = 'ba_1') {
  db.user.findUnique.mockResolvedValue({ betterAuthId })
  db.baSession.findFirst.mockResolvedValue({ id: 'sess_1', expiresAt: new Date(Date.now() + 60000) })
}

function mockUserOffline(betterAuthId = 'ba_1', emailAchievements = false) {
  db.user.findUnique.mockImplementation(({ where }) => {
    if (where.id) return Promise.resolve({ betterAuthId, email: 'user@test.com', displayName: 'Test User', emailAchievements })
    return Promise.resolve(null)
  })
  db.baSession.findFirst.mockResolvedValue(null)
}

// ---------------------------------------------------------------------------
// queueNotification — deduplication
// ---------------------------------------------------------------------------

describe('queueNotification — deduplication', () => {
  it('inserts notification when no duplicate exists', async () => {
    db.user.findUnique.mockResolvedValue({ betterAuthId: 'ba_1' })
    db.baSession.findFirst.mockResolvedValue(null)
    db.user.findUnique.mockResolvedValue({ betterAuthId: 'ba_1', email: 'u@t.com', displayName: 'U', emailAchievements: false })
    const result = await queueNotification('usr_1', 'first_hpc', { message: 'First!' })
    expect(db.userNotification.create).toHaveBeenCalledOnce()
    expect(result).not.toBeNull()
  })

  it('skips insert when undelivered duplicate exists (same type, first_hpc)', async () => {
    db.userNotification.findFirst.mockResolvedValue({ id: 'existing' })
    const result = await queueNotification('usr_1', 'first_hpc', { message: 'First!' })
    expect(db.userNotification.create).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('skips duplicate tier_upgrade with same tier', async () => {
    db.userNotification.findFirst.mockResolvedValue({ id: 'existing' })
    const result = await queueNotification('usr_1', 'tier_upgrade', { tier: 2, tierName: 'Gold', tierIcon: '🥇', unlockedLimits: { bots: 8 }, message: 'Gold!' })
    expect(db.userNotification.create).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('skips duplicate credit_milestone with same score', async () => {
    db.userNotification.findFirst.mockResolvedValue({ id: 'existing' })
    const result = await queueNotification('usr_1', 'credit_milestone', { score: 100, message: '100 points!' })
    expect(db.userNotification.create).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// queueNotification — email delivery
// ---------------------------------------------------------------------------

describe('queueNotification — email delivery', () => {
  it('sends email when user is offline and opted in', async () => {
    mockUserOffline('ba_1', true)
    await queueNotification('usr_1', 'first_hpc', { message: 'First PvP game!' })
    expect(emailSend).toHaveBeenCalledOnce()
    expect(db.userNotification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ emailedAt: expect.any(Date) }) })
    )
  })

  it('does not send email when user is online (even if opted in)', async () => {
    // user.findUnique called twice: once for betterAuthId, once for email/displayName/emailAchievements
    db.user.findUnique
      .mockResolvedValueOnce({ betterAuthId: 'ba_1' })
      .mockResolvedValueOnce({ betterAuthId: 'ba_1', email: 'u@t.com', displayName: 'U', emailAchievements: true })
    db.baSession.findFirst.mockResolvedValue({ id: 'sess_1', expiresAt: new Date(Date.now() + 60000) })
    await queueNotification('usr_1', 'first_hpc', { message: 'First!' })
    expect(emailSend).not.toHaveBeenCalled()
    expect(db.userNotification.update).not.toHaveBeenCalled()
  })

  it('does not send email when user is offline but not opted in', async () => {
    mockUserOffline('ba_1', false)
    await queueNotification('usr_1', 'first_hpc', { message: 'First!' })
    expect(emailSend).not.toHaveBeenCalled()
    expect(db.userNotification.update).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// checkAndNotify
// ---------------------------------------------------------------------------

describe('checkAndNotify', () => {
  beforeEach(() => {
    getTierLimit.mockResolvedValue(5)
    db.user.findUnique.mockResolvedValue({ betterAuthId: 'ba_1', email: 'u@t.com', displayName: 'U', emailAchievements: false })
    db.baSession.findFirst.mockResolvedValue(null)
  })

  it('queues tier_upgrade when tier increased', async () => {
    getUserCredits.mockResolvedValue({ tier: 1, tierName: 'Silver', tierIcon: '🥈', hpc: 25, bpc: 0, tc: 0, activityScore: 25, nextTier: 2, pointsToNextTier: 75 })
    await checkAndNotify('usr_1', { tier: 0, hpc: 24, bpc: 0, tc: 0, activityScore: 24 })
    expect(db.userNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'tier_upgrade' }) })
    )
  })

  it('queues first_hpc when hpc goes from 0 to 1', async () => {
    getUserCredits.mockResolvedValue({ tier: 0, tierName: 'Bronze', tierIcon: '🥉', hpc: 1, bpc: 0, tc: 0, activityScore: 1, nextTier: 1, pointsToNextTier: 24 })
    await checkAndNotify('usr_1', { tier: 0, hpc: 0, bpc: 0, tc: 0, activityScore: 0 })
    expect(db.userNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'first_hpc' }) })
    )
  })

  it('queues first_bpc when bpc goes from 0 to 1', async () => {
    getUserCredits.mockResolvedValue({ tier: 0, tierName: 'Bronze', tierIcon: '🥉', hpc: 0, bpc: 1, tc: 0, activityScore: 1, nextTier: 1, pointsToNextTier: 24 })
    await checkAndNotify('usr_1', { tier: 0, hpc: 0, bpc: 0, tc: 0, activityScore: 0 })
    expect(db.userNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'first_bpc' }) })
    )
  })

  it('queues credit_milestone when score crosses 100', async () => {
    getUserCredits.mockResolvedValue({ tier: 2, tierName: 'Gold', tierIcon: '🥇', hpc: 100, bpc: 0, tc: 0, activityScore: 100, nextTier: 3, pointsToNextTier: 400 })
    await checkAndNotify('usr_1', { tier: 1, hpc: 99, bpc: 0, tc: 0, activityScore: 99 })
    const calls = db.userNotification.create.mock.calls.map(c => c[0].data.type)
    expect(calls).toContain('credit_milestone')
  })

  it('is a no-op when nothing changed', async () => {
    getUserCredits.mockResolvedValue({ tier: 0, tierName: 'Bronze', tierIcon: '🥉', hpc: 5, bpc: 0, tc: 0, activityScore: 5, nextTier: 1, pointsToNextTier: 20 })
    await checkAndNotify('usr_1', { tier: 0, hpc: 4, bpc: 0, tc: 0, activityScore: 4 })
    expect(db.userNotification.create).not.toHaveBeenCalled()
  })

  it('does not queue credit_milestone when score was already past milestone', async () => {
    getUserCredits.mockResolvedValue({ tier: 2, tierName: 'Gold', tierIcon: '🥇', hpc: 110, bpc: 0, tc: 0, activityScore: 110, nextTier: 3, pointsToNextTier: 390 })
    await checkAndNotify('usr_1', { tier: 2, hpc: 105, bpc: 0, tc: 0, activityScore: 105 })
    expect(db.userNotification.create).not.toHaveBeenCalled()
  })
})
