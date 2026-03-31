import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// ALL vi.mock() calls BEFORE any await import()
vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => { req.auth = { userId: 'test-user-id' }; next() },
  optionalAuth: (req, res, next) => next(),
}))
vi.mock('../../realtime/roomManager.js', () => ({
  roomManager: {
    _pool: { acquire: vi.fn() },
    getRoom: vi.fn(),
    listRooms: vi.fn(),
  },
}))
vi.mock('../../realtime/botGameRunner.js', () => ({
  botGameRunner: {
    getGame: vi.fn(),
    listGames: vi.fn(),
  },
}))
vi.mock('../../realtime/mountainNames.js', () => ({
  MountainNamePool: {
    toSlug: vi.fn((name) => `mt-${name.toLowerCase()}`),
    fromSlug: vi.fn((slug) => `Mt. ${slug.replace(/^mt-/, '')}`),
  },
}))

const { roomManager } = await import('../../realtime/roomManager.js')
const { botGameRunner } = await import('../../realtime/botGameRunner.js')
const roomsRouter = (await import('../rooms.js')).default

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/', roomsRouter)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  roomManager._pool.acquire.mockReturnValue(null)
  roomManager.getRoom.mockReturnValue(null)
  roomManager.listRooms.mockReturnValue([])
  botGameRunner.getGame.mockReturnValue(null)
  botGameRunner.listGames.mockReturnValue([])
})

describe('POST /', () => {
  it('returns 503 when pool.acquire() returns null', async () => {
    roomManager._pool.acquire.mockReturnValue(null)

    const res = await request(buildApp()).post('/').send({})
    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/No rooms available/)
  })

  it('returns 200 with slug, displayName, and inviteUrl when pool returns a name', async () => {
    roomManager._pool.acquire.mockReturnValue('Everest')

    const res = await request(buildApp()).post('/').send({})
    expect(res.status).toBe(200)
    expect(res.body.slug).toBe('mt-everest')
    expect(res.body.displayName).toBe('Mt. Everest')
    expect(res.body.inviteUrl).toBe('/room/mt-everest')
  })
})

describe('GET /', () => {
  it('returns 200 with combined array from listRooms and listGames', async () => {
    const pvpRoom = { slug: 'mt-k2', displayName: 'Mt. K2', status: 'waiting' }
    const botGame = { slug: 'bot-game-1', displayName: 'Alpha vs Beta', status: 'playing' }
    roomManager.listRooms.mockReturnValue([pvpRoom])
    botGameRunner.listGames.mockReturnValue([botGame])

    const res = await request(buildApp()).get('/')
    expect(res.status).toBe(200)
    expect(res.body.rooms).toEqual([pvpRoom, botGame])
  })

  it('returns 200 with empty array when nothing is active', async () => {
    roomManager.listRooms.mockReturnValue([])
    botGameRunner.listGames.mockReturnValue([])

    const res = await request(buildApp()).get('/')
    expect(res.status).toBe(200)
    expect(res.body.rooms).toEqual([])
  })
})

describe('GET /:slug', () => {
  const PVP_ROOM = {
    slug: 'mt-everest',
    displayName: 'Mt. Everest',
    status: 'waiting',
    spectatorAllowed: true,
    spectatorIds: new Set(['s1', 's2']),
  }

  const BOT_GAME = {
    slug: 'bot-game-1',
    displayName: 'Alpha vs Beta',
    status: 'playing',
    spectatorIds: new Set(),
    bot1: { displayName: 'Alpha' },
    bot2: { displayName: 'Beta' },
  }

  it('returns 200 with room data from roomManager when found', async () => {
    roomManager.getRoom.mockReturnValue(PVP_ROOM)

    const res = await request(buildApp()).get('/mt-everest')
    expect(res.status).toBe(200)
    expect(res.body.room.slug).toBe('mt-everest')
    expect(res.body.room.displayName).toBe('Mt. Everest')
    expect(res.body.room.status).toBe('waiting')
    expect(res.body.room.spectatorAllowed).toBe(true)
    expect(res.body.room.spectatorCount).toBe(2)
    expect(res.body.room.isBotGame).toBeUndefined()
    expect(roomManager.getRoom).toHaveBeenCalledWith('mt-everest')
  })

  it('falls back to botGameRunner when roomManager returns null', async () => {
    roomManager.getRoom.mockReturnValue(null)
    botGameRunner.getGame.mockReturnValue(BOT_GAME)

    const res = await request(buildApp()).get('/bot-game-1')
    expect(res.status).toBe(200)
    expect(res.body.room.slug).toBe('bot-game-1')
    expect(res.body.room.isBotGame).toBe(true)
    expect(res.body.room.spectatorAllowed).toBe(true)
    expect(res.body.room.spectatorCount).toBe(0)
    expect(res.body.room.bot1).toEqual({ displayName: 'Alpha', mark: 'X' })
    expect(res.body.room.bot2).toEqual({ displayName: 'Beta', mark: 'O' })
    expect(botGameRunner.getGame).toHaveBeenCalledWith('bot-game-1')
  })

  it('returns 404 when neither roomManager nor botGameRunner has the slug', async () => {
    roomManager.getRoom.mockReturnValue(null)
    botGameRunner.getGame.mockReturnValue(null)

    const res = await request(buildApp()).get('/no-such-room')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/Room not found/)
  })
})
