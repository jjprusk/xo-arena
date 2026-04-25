// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Demo Table macro endpoint — Hook step 2 (§5.1).
 *
 * Covers:
 *   - 201 happy path: matchup picked, bots resolved, table created with
 *     isDemo=true, isPrivate=true, ACTIVE, both bots seated, runner started
 *   - 503 when matchup bots are missing (seed not run)
 *   - One-active-per-user: prior demo deleted + runner closed before new one
 *   - 503 when bot game runner refuses to start (rolls back the table)
 *   - GET / list filter — other users' demo tables hidden
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.auth = { userId: 'ba_user_1' }
    next()
  },
  optionalAuth: vi.fn((req, _res, next) => {
    req.auth = null
    next()
  }),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    table: {
      create:     vi.fn(),
      findMany:   vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      update:     vi.fn(),
      delete:     vi.fn(),
      deleteMany: vi.fn(),
      count:      vi.fn().mockResolvedValue(0),
    },
    user: {
      findMany:   vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}))

vi.mock('../../lib/notificationBus.js', () => ({
  dispatch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../realtime/botGameRunner.js', () => ({
  botGameRunner: {
    startGame:        vi.fn(),
    closeGameBySlug:  vi.fn(),
    getSlugForMatch:  vi.fn(),
  },
}))

// Force a deterministic matchup pick so we don't have to mock Math.random.
vi.mock('../../config/demoTableMatchups.js', () => ({
  DEMO_TABLE_MATCHUPS: [{ x: 'bot-copper', o: 'bot-sterling' }],
  pickMatchup: vi.fn(),
}))

// Mountain pool — give us predictable names for slug verification.
vi.mock('../../realtime/mountainNames.js', () => ({
  mountainPool: {
    acquire: vi.fn(),
    release: vi.fn(),
    swap:    vi.fn(),
  },
  MountainNamePool: {
    toSlug:   (n) => `mt-${n.toLowerCase()}`,
    fromSlug: (s) => `Mt. ${s.replace(/^mt-/, '')}`,
  },
}))

const tablesRouter = (await import('../tables.js')).default
const db = (await import('../../lib/db.js')).default
const { botGameRunner } = await import('../../realtime/botGameRunner.js')
const { mountainPool } = await import('../../realtime/mountainNames.js')
const { dispatch } = await import('../../lib/notificationBus.js')
const { pickMatchup } = await import('../../config/demoTableMatchups.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/tables', tablesRouter)
  return app
}

const copperBot = {
  id: 'bot_copper',
  isBot: true,
  username: 'bot-copper',
  displayName: 'Copper',
  botModelId: 'builtin:minimax:intermediate',
}
const sterlingBot = {
  id: 'bot_sterling',
  isBot: true,
  username: 'bot-sterling',
  displayName: 'Sterling',
  botModelId: 'builtin:minimax:advanced',
}

beforeEach(() => {
  vi.clearAllMocks()
  pickMatchup.mockReturnValue({ x: 'bot-copper', o: 'bot-sterling' })
  botGameRunner.startGame.mockResolvedValue({ slug: 'mt-test', displayName: 'Mt. Test' })
  botGameRunner.getSlugForMatch.mockReturnValue(null)
  // Fresh per-test pool so .shift() doesn't deplete across tests.
  const poolQueue = ['Everest', 'K2', 'Lhotse']
  mountainPool.acquire.mockImplementation(() => poolQueue.shift() ?? null)
  db.table.findMany.mockResolvedValue([])
  db.user.findUnique.mockImplementation(async ({ where }) => {
    if (where?.username === 'bot-copper')   return copperBot
    if (where?.username === 'bot-sterling') return sterlingBot
    return null
  })
})

describe('POST /api/v1/tables/demo', () => {
  it('creates an isDemo, private, ACTIVE table seated by both bots and starts the runner', async () => {
    db.table.create.mockResolvedValue({
      id: 'tbl_demo_1',
      slug: 'mt-everest',
      displayName: 'Mt. Everest',
      isDemo: true,
      isPrivate: true,
      status: 'ACTIVE',
      createdById: 'ba_user_1',
      seats: [
        { userId: 'bot_copper',   status: 'occupied' },
        { userId: 'bot_sterling', status: 'occupied' },
      ],
    })

    const res = await request(makeApp()).post('/api/v1/tables/demo')

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      tableId: 'tbl_demo_1',
      slug:    'mt-everest',
      botA:    { id: 'bot_copper',   displayName: 'Copper' },
      botB:    { id: 'bot_sterling', displayName: 'Sterling' },
    })
    expect(db.table.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        gameId:       'xo',
        slug:         'mt-everest',
        displayName:  'Mt. Everest',
        createdById:  'ba_user_1',
        isPrivate:    true,
        isDemo:       true,
        status:       'ACTIVE',
        seats: [
          { userId: 'bot_copper',   status: 'occupied' },
          { userId: 'bot_sterling', status: 'occupied' },
        ],
      }),
    }))
    expect(botGameRunner.startGame).toHaveBeenCalledWith(expect.objectContaining({
      slug:         'mt-everest',
      displayName:  'Mt. Everest',
      mountainName: 'Everest',
      bestOfN:      1,
      bot1: { id: 'bot_copper',   displayName: 'Copper',   botModelId: 'builtin:minimax:intermediate' },
      bot2: { id: 'bot_sterling', displayName: 'Sterling', botModelId: 'builtin:minimax:advanced' },
    }))
  })

  it('returns 503 when matchup references a missing bot (seed not run)', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const res = await request(makeApp()).post('/api/v1/tables/demo')
    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/not provisioned/i)
    expect(db.table.create).not.toHaveBeenCalled()
    expect(botGameRunner.startGame).not.toHaveBeenCalled()
  })

  it('tears down a prior in-flight demo (deletes table + closes runner) before creating a new one', async () => {
    db.table.findMany.mockResolvedValueOnce([
      { id: 'tbl_old', slug: 'mt-old' },
    ])
    db.table.delete.mockResolvedValue({})
    db.table.create.mockResolvedValue({ id: 'tbl_demo_2', slug: 'mt-everest', displayName: 'Mt. Everest' })

    const res = await request(makeApp()).post('/api/v1/tables/demo')
    expect(res.status).toBe(201)

    // Existing demo lookup
    expect(db.table.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        createdById: 'ba_user_1',
        isDemo: true,
      }),
    }))
    // Runner closed for the old slug
    expect(botGameRunner.closeGameBySlug).toHaveBeenCalledWith('mt-old')
    // Old table deleted
    expect(db.table.delete).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tbl_old' },
    }))
    // table.deleted broadcast
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'table.deleted',
      payload: expect.objectContaining({ tableId: 'tbl_old' }),
    }))
  })

  it('rolls back the table row and frees the mountain name when runner.startGame throws', async () => {
    db.table.create.mockResolvedValue({ id: 'tbl_demo_3', slug: 'mt-everest' })
    db.table.delete.mockResolvedValue({})
    botGameRunner.startGame.mockRejectedValueOnce(new Error('no slot'))

    const res = await request(makeApp()).post('/api/v1/tables/demo')

    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/start demo/i)
    expect(db.table.delete).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tbl_demo_3' },
    }))
    expect(mountainPool.release).toHaveBeenCalledWith('Everest')
  })

  it('retries on slug collision (P2002) before giving up', async () => {
    const p2002 = Object.assign(new Error('unique'), { code: 'P2002' })
    db.table.create
      .mockRejectedValueOnce(p2002)
      .mockResolvedValueOnce({ id: 'tbl_demo_4', slug: 'mt-k2', displayName: 'Mt. K2' })

    const res = await request(makeApp()).post('/api/v1/tables/demo')

    expect(res.status).toBe(201)
    expect(db.table.create).toHaveBeenCalledTimes(2)
    // Second attempt used the next mountain name (K2 → mt-k2)
    expect(res.body.slug).toBe('mt-k2')
    // First name was returned to the pool when the create collided
    expect(mountainPool.release).toHaveBeenCalledWith('Everest')
  })
})

describe('GET /api/v1/tables — isDemo visibility filter', () => {
  it("excludes other users' demo tables from the public list (unauth)", async () => {
    db.table.findMany.mockResolvedValueOnce([])
    db.table.count.mockResolvedValueOnce(0)
    await request(makeApp()).get('/api/v1/tables')
    // The where clause should AND in an isDemo guard.
    expect(db.table.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([{ isDemo: false }]),
          }),
        ]),
      }),
    }))
  })

  it('?mine=true skips the isDemo filter (caller sees their own demos)', async () => {
    // Override the mocked optionalAuth to authenticate this caller — the
    // ?mine=true path requires it.
    const auth = await import('../../middleware/auth.js')
    auth.optionalAuth.mockImplementationOnce((req, _res, next) => {
      req.auth = { userId: 'ba_user_1' }
      next()
    })
    db.table.findMany.mockResolvedValueOnce([])
    db.table.count.mockResolvedValueOnce(0)
    await request(makeApp()).get('/api/v1/tables?mine=true')
    const args = db.table.findMany.mock.calls[0][0]
    // No AND clause — just the simple createdById visibility.
    expect(args.where).toEqual({ createdById: 'ba_user_1' })
  })
})
