import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock notificationBus (dispatch is now the integration point) ─────────────

const mockDispatch = vi.fn().mockResolvedValue({ id: 'notif_1' })
vi.mock('../../lib/notificationBus.js', () => ({ dispatch: mockDispatch }))

// ─── Mock db ──────────────────────────────────────────────────────────────────

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

const { queueNotification, checkAndNotify, sendEmail } = await import('../notificationService.js')
const db = (await import('../../lib/db.js')).default
const { getUserCredits, getTierLimit } = await import('../../services/creditService.js')
const { Resend } = await import('resend')
const emailSend = Resend.mock.results[0]?.value?.emails?.send

beforeEach(() => {
  vi.clearAllMocks()
  mockDispatch.mockResolvedValue({ id: 'notif_1' })
  db.systemConfig.findUnique.mockResolvedValue(null)
  db.userNotification.findFirst.mockResolvedValue(null)
  db.userNotification.create.mockResolvedValue({ id: 'notif_1', userId: 'usr_1', type: 'first_hpc', payload: {}, createdAt: new Date() })
  db.userNotification.update.mockResolvedValue({})
})

// ---------------------------------------------------------------------------
// queueNotification — type mapping and dispatch delegation
// ---------------------------------------------------------------------------

describe('queueNotification — dispatch mapping', () => {
  it('maps first_hpc to achievement.milestone and calls dispatch', async () => {
    const result = await queueNotification('usr_1', 'first_hpc', { message: 'First!' })
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'achievement.milestone',
      targets: { userId: 'usr_1' },
      payload: { message: 'First!' },
    })
    expect(result).not.toBeNull()
  })

  it('returns null when dispatch returns null (duplicate suppressed by bus)', async () => {
    mockDispatch.mockResolvedValue(null)
    const result = await queueNotification('usr_1', 'first_hpc', { message: 'First!' })
    expect(mockDispatch).toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('maps tier_upgrade to achievement.tier_upgrade', async () => {
    await queueNotification('usr_1', 'tier_upgrade', { tier: 2, tierName: 'Gold', tierIcon: '🥇', unlockedLimits: { bots: 8 }, message: 'Gold!' })
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'achievement.tier_upgrade', targets: { userId: 'usr_1' } })
    )
  })

  it('maps credit_milestone to achievement.milestone', async () => {
    await queueNotification('usr_1', 'credit_milestone', { score: 100, message: '100 points!' })
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'achievement.milestone' })
    )
  })

  it('returns null for unknown legacy type without calling dispatch', async () => {
    const result = await queueNotification('usr_1', 'unknown_legacy_type', {})
    expect(mockDispatch).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// sendEmail — direct email delivery
// ---------------------------------------------------------------------------

describe('sendEmail', () => {
  it('sends email when user has an email address', async () => {
    db.user.findUnique.mockResolvedValue({ email: 'user@test.com', displayName: 'Test User' })
    await sendEmail('usr_1', 'achievement.milestone', { message: 'First PvP game!' })
    expect(emailSend).toHaveBeenCalledOnce()
    expect(emailSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@test.com' })
    )
  })

  it('does not send email when user has no email', async () => {
    db.user.findUnique.mockResolvedValue({ email: null, displayName: 'Test User' })
    await sendEmail('usr_1', 'achievement.milestone', { message: 'First!' })
    expect(emailSend).not.toHaveBeenCalled()
  })

  it('does not send email when user is not found', async () => {
    db.user.findUnique.mockResolvedValue(null)
    await sendEmail('usr_1', 'achievement.milestone', {})
    expect(emailSend).not.toHaveBeenCalled()
  })

  it('uses match result template for match.result type', async () => {
    db.user.findUnique.mockResolvedValue({ email: 'user@test.com', displayName: 'Test User' })
    await sendEmail('usr_1', 'match.result', { matchId: 'm1' })
    expect(emailSend).toHaveBeenCalledOnce()
    const call = emailSend.mock.calls[0][0]
    expect(call.subject).toContain('Match result')
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

  it('dispatches achievement.tier_upgrade when tier increased', async () => {
    getUserCredits.mockResolvedValue({ tier: 1, tierName: 'Silver', tierIcon: '🥈', hpc: 25, bpc: 0, tc: 0, activityScore: 25, nextTier: 2, pointsToNextTier: 75 })
    await checkAndNotify('usr_1', { tier: 0, hpc: 24, bpc: 0, tc: 0, activityScore: 24 })
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'achievement.tier_upgrade', targets: { userId: 'usr_1' } })
    )
  })

  it('dispatches achievement.milestone when hpc goes from 0 to 1', async () => {
    getUserCredits.mockResolvedValue({ tier: 0, tierName: 'Bronze', tierIcon: '🥉', hpc: 1, bpc: 0, tc: 0, activityScore: 1, nextTier: 1, pointsToNextTier: 24 })
    await checkAndNotify('usr_1', { tier: 0, hpc: 0, bpc: 0, tc: 0, activityScore: 0 })
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'achievement.milestone', targets: { userId: 'usr_1' } })
    )
  })

  it('dispatches achievement.milestone when bpc goes from 0 to 1', async () => {
    getUserCredits.mockResolvedValue({ tier: 0, tierName: 'Bronze', tierIcon: '🥉', hpc: 0, bpc: 1, tc: 0, activityScore: 1, nextTier: 1, pointsToNextTier: 24 })
    await checkAndNotify('usr_1', { tier: 0, hpc: 0, bpc: 0, tc: 0, activityScore: 0 })
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'achievement.milestone' })
    )
  })

  it('dispatches achievement.milestone when score crosses 100', async () => {
    getUserCredits.mockResolvedValue({ tier: 2, tierName: 'Gold', tierIcon: '🥇', hpc: 100, bpc: 0, tc: 0, activityScore: 100, nextTier: 3, pointsToNextTier: 400 })
    await checkAndNotify('usr_1', { tier: 1, hpc: 99, bpc: 0, tc: 0, activityScore: 99 })
    const types = mockDispatch.mock.calls.map(c => c[0].type)
    expect(types).toContain('achievement.milestone')
  })

  it('is a no-op when nothing changed', async () => {
    getUserCredits.mockResolvedValue({ tier: 0, tierName: 'Bronze', tierIcon: '🥉', hpc: 5, bpc: 0, tc: 0, activityScore: 5, nextTier: 1, pointsToNextTier: 20 })
    await checkAndNotify('usr_1', { tier: 0, hpc: 4, bpc: 0, tc: 0, activityScore: 4 })
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('does not dispatch milestone when score was already past it', async () => {
    getUserCredits.mockResolvedValue({ tier: 2, tierName: 'Gold', tierIcon: '🥇', hpc: 110, bpc: 0, tc: 0, activityScore: 110, nextTier: 3, pointsToNextTier: 390 })
    await checkAndNotify('usr_1', { tier: 2, hpc: 105, bpc: 0, tc: 0, activityScore: 105 })
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('dispatches achievement.milestone when tc goes from 0 to 1', async () => {
    getUserCredits.mockResolvedValue({ tier: 0, tierName: 'Bronze', tierIcon: '🥉', hpc: 0, bpc: 0, tc: 1, activityScore: 5, nextTier: 1, pointsToNextTier: 20 })
    await checkAndNotify('usr_1', { tier: 0, hpc: 0, bpc: 0, tc: 0, activityScore: 0 })
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'achievement.milestone' })
    )
  })
})
