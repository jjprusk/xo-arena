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
  },
}))

const usersRouter = (await import('../users.js')).default
const { getUserById, updateUser, getUserStats } = await import('../../services/userService.js')

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
