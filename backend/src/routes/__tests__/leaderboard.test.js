import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../services/userService.js', () => ({
  getLeaderboard: vi.fn(),
}))

vi.mock('../../utils/cache.js', () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
    invalidate: vi.fn(),
  },
}))

const leaderboardRouter = (await import('../leaderboard.js')).default
const { getLeaderboard } = await import('../../services/userService.js')
const cache = (await import('../../utils/cache.js')).default

const app = express()
app.use(express.json())
app.use('/api/v1/leaderboard', leaderboardRouter)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BOARD = [
  { id: 'usr_1', displayName: 'Alice', eloRating: 1500, wins: 10, losses: 2 },
  { id: 'usr_2', displayName: 'Bob',   eloRating: 1400, wins: 7,  losses: 4 },
]

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/v1/leaderboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cache.get.mockReturnValue(null)  // default: cache miss
    getLeaderboard.mockResolvedValue(BOARD)
  })

  it('returns leaderboard data on cache miss', async () => {
    const res = await request(app).get('/api/v1/leaderboard')
    expect(res.status).toBe(200)
    expect(res.body.leaderboard).toHaveLength(2)
    expect(res.body.leaderboard[0].displayName).toBe('Alice')
  })

  it('sets X-Cache: MISS on cache miss', async () => {
    const res = await request(app).get('/api/v1/leaderboard')
    expect(res.headers['x-cache']).toBe('MISS')
  })

  it('stores result in cache after a miss', async () => {
    await request(app).get('/api/v1/leaderboard')
    expect(cache.set).toHaveBeenCalledOnce()
    const [key, data, ttl] = cache.set.mock.calls[0]
    expect(key).toMatch(/^leaderboard:/)
    expect(data).toEqual(BOARD)
    expect(ttl).toBe(60_000)
  })

  it('returns cached data and X-Cache: HIT on cache hit', async () => {
    cache.get.mockReturnValue(BOARD)
    const res = await request(app).get('/api/v1/leaderboard')
    expect(res.status).toBe(200)
    expect(res.body.leaderboard).toHaveLength(2)
    expect(res.headers['x-cache']).toBe('HIT')
    expect(getLeaderboard).not.toHaveBeenCalled()
  })

  it('passes default params to getLeaderboard', async () => {
    await request(app).get('/api/v1/leaderboard')
    expect(getLeaderboard).toHaveBeenCalledWith({
      period: 'all',
      mode: 'all',
      limit: 50,
      includeBots: false,
    })
  })

  it('passes period=monthly to getLeaderboard', async () => {
    await request(app).get('/api/v1/leaderboard?period=monthly')
    expect(getLeaderboard).toHaveBeenCalledWith(expect.objectContaining({ period: 'monthly' }))
  })

  it('passes mode=hvh to getLeaderboard', async () => {
    await request(app).get('/api/v1/leaderboard?mode=hvh')
    expect(getLeaderboard).toHaveBeenCalledWith(expect.objectContaining({ mode: 'hvh' }))
  })

  it('passes includeBots=true when query param is "true"', async () => {
    await request(app).get('/api/v1/leaderboard?includeBots=true')
    expect(getLeaderboard).toHaveBeenCalledWith(expect.objectContaining({ includeBots: true }))
  })

  it('clamps limit to 100', async () => {
    await request(app).get('/api/v1/leaderboard?limit=999')
    expect(getLeaderboard).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }))
  })

  it('uses a distinct cache key per param combination', async () => {
    await request(app).get('/api/v1/leaderboard?period=weekly&mode=hvh&limit=10&includeBots=true')
    const [key] = cache.set.mock.calls[0]
    expect(key).toBe('leaderboard:weekly:hvh:10:true')
  })

  it('returns 500 on service error', async () => {
    getLeaderboard.mockRejectedValue(new Error('db error'))
    // Express default error handler returns 500
    const res = await request(app).get('/api/v1/leaderboard')
    expect(res.status).toBe(500)
  })
})
