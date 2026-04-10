import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock auth middleware to bypass Better Auth in route tests
vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.auth = { userId: 'ba_user_1' }
    next()
  },
  optionalAuth: (req, _res, next) => {
    req.auth = { userId: 'ba_user_1' }
    next()
  },
}))

// Mock userService
vi.mock('../../services/userService.js', () => ({
  getUserById: vi.fn(),
  updateUser: vi.fn(),
  getUserStats: vi.fn(),
  syncUser: vi.fn(),
}))

// Mock db for sync endpoint (baUser lookup) and game history
vi.mock('../../lib/db.js', () => ({
  default: {
    baUser: {
      findUnique: vi.fn(async () => ({
        id: 'ba_user_1',
        email: 'a@b.com',
        name: 'Test User',
        image: null,
      })),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(async () => ({})),
    },
    game: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    userEloHistory: {
      findMany: vi.fn(async () => []),
    },
    mLPlayerProfile: {
      findMany: vi.fn(async () => []),
    },
    userNotification: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}))

vi.mock('../../services/creditService.js', () => ({
  getUserCredits: vi.fn(),
}))

const usersRouter = (await import('../users.js')).default
const { getUserById, updateUser, getUserStats } = await import('../../services/userService.js')
const { getUserCredits } = await import('../../services/creditService.js')
const db = (await import('../../lib/db.js')).default

const app = express()
app.use(express.json())
app.use('/api/v1/users', usersRouter)

const mockUser = {
  id: 'usr_1',
  betterAuthId: 'ba_user_1',
  email: 'a@b.com',
  displayName: 'Test User',
  avatarUrl: null,
  preferences: {},
  createdAt: new Date().toISOString(),
}

describe('GET /api/v1/users/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 when user not found', async () => {
    getUserById.mockResolvedValue(null)
    const res = await request(app).get('/api/v1/users/nonexistent')
    expect(res.status).toBe(404)
  })

  it('returns user data', async () => {
    getUserById.mockResolvedValue(mockUser)
    const res = await request(app).get('/api/v1/users/usr_1')
    expect(res.status).toBe(200)
    expect(res.body.user.id).toBe('usr_1')
  })

  it('includes private fields for own profile', async () => {
    getUserById.mockResolvedValue(mockUser)
    const res = await request(app).get('/api/v1/users/usr_1')
    expect(res.body.user.email).toBeDefined()
  })
})

describe('PATCH /api/v1/users/:id', () => {
  it('returns 404 when user not found', async () => {
    getUserById.mockResolvedValue(null)
    const res = await request(app).patch('/api/v1/users/usr_1').send({ displayName: 'New' })
    expect(res.status).toBe(404)
  })

  it('returns 403 when editing another user', async () => {
    getUserById.mockResolvedValue({ ...mockUser, betterAuthId: 'other_ba_user' })
    const res = await request(app).patch('/api/v1/users/usr_1').send({ displayName: 'New' })
    expect(res.status).toBe(403)
  })

  it('updates user successfully', async () => {
    const updated = { ...mockUser, displayName: 'New Name' }
    getUserById.mockResolvedValue(mockUser)
    updateUser.mockResolvedValue(updated)
    const res = await request(app).patch('/api/v1/users/usr_1').send({ displayName: 'New Name' })
    expect(res.status).toBe(200)
    expect(res.body.user.displayName).toBe('New Name')
  })

  it('returns 400 for empty displayName', async () => {
    getUserById.mockResolvedValue(mockUser)
    const res = await request(app).patch('/api/v1/users/usr_1').send({ displayName: '' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/users/:id/stats', () => {
  it('returns stats for existing user', async () => {
    getUserById.mockResolvedValue(mockUser)
    getUserStats.mockResolvedValue({ totalGames: 5, wins: 3, winRate: 0.6 })
    const res = await request(app).get('/api/v1/users/usr_1/stats')
    expect(res.status).toBe(200)
    expect(res.body.stats.totalGames).toBe(5)
  })

  it('returns 404 for unknown user', async () => {
    getUserById.mockResolvedValue(null)
    const res = await request(app).get('/api/v1/users/bad/stats')
    expect(res.status).toBe(404)
  })
})

describe('GET /api/v1/users/:id/games', () => {
  it('returns paginated games', async () => {
    getUserById.mockResolvedValue(mockUser)
    const res = await request(app).get('/api/v1/users/usr_1/games')
    expect(res.status).toBe(200)
    expect(res.body.games).toBeInstanceOf(Array)
    expect(res.body.total).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Credits endpoint (3a)
// ---------------------------------------------------------------------------

describe('GET /api/v1/users/:id/credits', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns credits shape for existing user', async () => {
    getUserById.mockResolvedValue(mockUser)
    getUserCredits.mockResolvedValue({
      hpc: 10, bpc: 5, tc: 0,
      activityScore: 15,
      tier: 0, tierName: 'Bronze', tierIcon: '🥉',
      nextTier: 1, pointsToNextTier: 10,
    })
    const res = await request(app).get('/api/v1/users/usr_1/credits')
    expect(res.status).toBe(200)
    expect(res.body.credits.hpc).toBe(10)
    expect(res.body.credits.tierName).toBe('Bronze')
  })

  it('returns 404 when user not found', async () => {
    getUserById.mockResolvedValue(null)
    getUserCredits.mockResolvedValue({ hpc: 0, bpc: 0, tc: 0, activityScore: 0, tier: 0, tierName: 'Bronze', tierIcon: '🥉', nextTier: 1, pointsToNextTier: 25 })
    const res = await request(app).get('/api/v1/users/bad/credits')
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Notification endpoints (3c)
// ---------------------------------------------------------------------------

describe('GET /api/v1/users/me/notifications', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns undelivered notifications for authenticated user', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'usr_1' })
    db.userNotification.findMany.mockResolvedValue([
      { id: 'n1', type: 'first_hpc', payload: { message: 'First!' }, createdAt: new Date() },
    ])
    const res = await request(app).get('/api/v1/users/me/notifications')
    expect(res.status).toBe(200)
    expect(res.body.notifications).toHaveLength(1)
    expect(res.body.notifications[0].type).toBe('first_hpc')
  })

  it('returns 404 when user not found', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const res = await request(app).get('/api/v1/users/me/notifications')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/users/me/notifications/deliver', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks notifications delivered and returns count', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'usr_1' })
    db.userNotification.updateMany.mockResolvedValue({ count: 2 })
    const res = await request(app)
      .post('/api/v1/users/me/notifications/deliver')
      .send({ ids: ['n1', 'n2'] })
    expect(res.status).toBe(200)
    expect(res.body.delivered).toBe(2)
  })

  it('ignores IDs that belong to other users (updateMany where userId filter)', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'usr_1' })
    db.userNotification.updateMany.mockResolvedValue({ count: 0 })
    const res = await request(app)
      .post('/api/v1/users/me/notifications/deliver')
      .send({ ids: ['other_user_notif'] })
    expect(res.status).toBe(200)
    expect(res.body.delivered).toBe(0)
    // Verify userId scoping was applied
    expect(db.userNotification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'usr_1' }) })
    )
  })

  it('returns 400 for empty ids array', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/notifications/deliver')
      .send({ ids: [] })
    expect(res.status).toBe(400)
  })

  it('returns 404 when user not found', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const res = await request(app)
      .post('/api/v1/users/me/notifications/deliver')
      .send({ ids: ['n1'] })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/v1/users/me/preferences', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns defaults when preferences are empty', async () => {
    db.user.findUnique.mockResolvedValue({ preferences: {} })
    const res = await request(app).get('/api/v1/users/me/preferences')
    expect(res.status).toBe(200)
    expect(res.body.showGuideButton).toBe(true)
    expect(res.body.tournamentResultNotifPref).toBe('AS_PLAYED')
  })

  it('returns stored tournamentResultNotifPref', async () => {
    db.user.findUnique.mockResolvedValue({
      preferences: { tournamentResultNotifPref: 'END_OF_TOURNAMENT' },
    })
    const res = await request(app).get('/api/v1/users/me/preferences')
    expect(res.status).toBe(200)
    expect(res.body.tournamentResultNotifPref).toBe('END_OF_TOURNAMENT')
  })

  it('returns false for showGuideButton when explicitly set', async () => {
    db.user.findUnique.mockResolvedValue({ preferences: { showGuideButton: false } })
    const res = await request(app).get('/api/v1/users/me/preferences')
    expect(res.status).toBe(200)
    expect(res.body.showGuideButton).toBe(false)
  })

  it('returns flashStartAlerts=true by default', async () => {
    db.user.findUnique.mockResolvedValue({ preferences: {} })
    const res = await request(app).get('/api/v1/users/me/preferences')
    expect(res.status).toBe(200)
    expect(res.body.flashStartAlerts).toBe(true)
  })

  it('returns flashStartAlerts=false when explicitly disabled', async () => {
    db.user.findUnique.mockResolvedValue({ preferences: { flashStartAlerts: false } })
    const res = await request(app).get('/api/v1/users/me/preferences')
    expect(res.status).toBe(200)
    expect(res.body.flashStartAlerts).toBe(false)
  })

  it('returns 404 when user not found', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const res = await request(app).get('/api/v1/users/me/preferences')
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/v1/users/me/preferences', () => {
  beforeEach(() => vi.clearAllMocks())

  it('saves AS_PLAYED tournamentResultNotifPref', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'usr_1', preferences: {} })
    db.user.update.mockResolvedValue({})
    const res = await request(app)
      .patch('/api/v1/users/me/preferences')
      .send({ tournamentResultNotifPref: 'AS_PLAYED' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { preferences: expect.objectContaining({ tournamentResultNotifPref: 'AS_PLAYED' }) },
      })
    )
  })

  it('saves END_OF_TOURNAMENT tournamentResultNotifPref', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'usr_1', preferences: {} })
    db.user.update.mockResolvedValue({})
    const res = await request(app)
      .patch('/api/v1/users/me/preferences')
      .send({ tournamentResultNotifPref: 'END_OF_TOURNAMENT' })
    expect(res.status).toBe(200)
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { preferences: expect.objectContaining({ tournamentResultNotifPref: 'END_OF_TOURNAMENT' }) },
      })
    )
  })

  it('ignores invalid tournamentResultNotifPref values', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'usr_1', preferences: {} })
    db.user.update.mockResolvedValue({})
    const res = await request(app)
      .patch('/api/v1/users/me/preferences')
      .send({ tournamentResultNotifPref: 'INVALID' })
    expect(res.status).toBe(200)
    const updateCall = db.user.update.mock.calls[0][0]
    expect(updateCall.data.preferences).not.toHaveProperty('tournamentResultNotifPref')
  })

  it('merges with existing preferences', async () => {
    db.user.findUnique.mockResolvedValue({
      id: 'usr_1',
      preferences: { showGuideButton: false, faqHintSeen: true },
    })
    db.user.update.mockResolvedValue({})
    await request(app)
      .patch('/api/v1/users/me/preferences')
      .send({ tournamentResultNotifPref: 'END_OF_TOURNAMENT' })
    const updateCall = db.user.update.mock.calls[0][0]
    expect(updateCall.data.preferences).toMatchObject({
      showGuideButton: false,
      faqHintSeen: true,
      tournamentResultNotifPref: 'END_OF_TOURNAMENT',
    })
  })

  it('saves flashStartAlerts=false', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'usr_1', preferences: {} })
    db.user.update.mockResolvedValue({})
    const res = await request(app)
      .patch('/api/v1/users/me/preferences')
      .send({ flashStartAlerts: false })
    expect(res.status).toBe(200)
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { preferences: expect.objectContaining({ flashStartAlerts: false }) },
      })
    )
  })

  it('saves flashStartAlerts=true', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'usr_1', preferences: { flashStartAlerts: false } })
    db.user.update.mockResolvedValue({})
    const res = await request(app)
      .patch('/api/v1/users/me/preferences')
      .send({ flashStartAlerts: true })
    expect(res.status).toBe(200)
    const updateCall = db.user.update.mock.calls[0][0]
    expect(updateCall.data.preferences.flashStartAlerts).toBe(true)
  })

  it('returns 404 when user not found', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const res = await request(app)
      .patch('/api/v1/users/me/preferences')
      .send({ tournamentResultNotifPref: 'AS_PLAYED' })
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/v1/users/me/settings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates emailAchievements setting', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'usr_1' })
    db.user.update.mockResolvedValue({})
    const res = await request(app)
      .patch('/api/v1/users/me/settings')
      .send({ emailAchievements: true })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { emailAchievements: true } })
    )
  })

  it('returns 400 when no valid settings provided', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'usr_1' })
    const res = await request(app)
      .patch('/api/v1/users/me/settings')
      .send({ unknownField: 'value' })
    expect(res.status).toBe(400)
  })

  it('returns 404 when user not found', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const res = await request(app)
      .patch('/api/v1/users/me/settings')
      .send({ emailAchievements: false })
    expect(res.status).toBe(404)
  })
})
