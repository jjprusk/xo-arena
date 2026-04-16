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
      findMany:   vi.fn(),
      findUnique: vi.fn(),
      update:     vi.fn(),
      delete:     vi.fn(),
    },
    // withSeatDisplay() hydrates occupied seats with User.displayName/avatarUrl.
    // buildSeatChangePayload() looks up the actor's displayName.
    // Defaults return empty so the bare-seats shape is preserved in assertions
    // and actorDisplayName is null; specific tests override as needed.
    user: {
      findMany:   vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}))

vi.mock('../../lib/notificationBus.js', () => ({
  dispatch: vi.fn().mockResolvedValue(undefined),
}))

const tablesRouter = (await import('../tables.js')).default
const db = (await import('../../lib/db.js')).default
const { optionalAuth } = await import('../../middleware/auth.js')
const { dispatch } = await import('../../lib/notificationBus.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/tables', tablesRouter)
  return app
}

const baseTable = {
  id: 'tbl_1',
  gameId: 'xo',
  status: 'FORMING',
  createdById: 'ba_user_1',
  minPlayers: 2,
  maxPlayers: 2,
  isPrivate: false,
  chatEnabled: false,
  isTournament: false,
  seats: [
    { userId: null, status: 'empty' },
    { userId: null, status: 'empty' },
  ],
  previewState: null,
  createdAt: new Date('2026-04-15T20:00:00Z'),
  updatedAt: new Date('2026-04-15T20:00:00Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── POST /api/v1/tables — create ──────────────────────────────────────────────

describe('POST /api/v1/tables', () => {
  it('creates a table with all-empty seats', async () => {
    db.table.create.mockResolvedValue(baseTable)
    const app = makeApp()
    const res = await request(app)
      .post('/api/v1/tables')
      .send({ gameId: 'xo', minPlayers: 2, maxPlayers: 2 })
    expect(res.status).toBe(201)
    expect(res.body.table.id).toBe('tbl_1')
    expect(db.table.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        gameId: 'xo',
        createdById: 'ba_user_1',
        minPlayers: 2,
        maxPlayers: 2,
        isPrivate: false,
        isTournament: false,
        seats: [
          { userId: null, status: 'empty' },
          { userId: null, status: 'empty' },
        ],
      }),
    }))
  })

  it('returns 400 when gameId is missing', async () => {
    const app = makeApp()
    const res = await request(app)
      .post('/api/v1/tables')
      .send({ minPlayers: 2, maxPlayers: 2 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/gameId/)
  })

  it('returns 400 when minPlayers is not a positive integer', async () => {
    const app = makeApp()
    const res = await request(app)
      .post('/api/v1/tables')
      .send({ gameId: 'xo', minPlayers: 0, maxPlayers: 2 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/minPlayers/)
  })

  it('returns 400 when maxPlayers < minPlayers', async () => {
    const app = makeApp()
    const res = await request(app)
      .post('/api/v1/tables')
      .send({ gameId: 'xo', minPlayers: 4, maxPlayers: 2 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/maxPlayers/)
  })

  it('returns 400 when isPrivate is not a boolean', async () => {
    const app = makeApp()
    const res = await request(app)
      .post('/api/v1/tables')
      .send({ gameId: 'xo', minPlayers: 2, maxPlayers: 2, isPrivate: 'yes' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/isPrivate/)
  })

  it('dispatches table.created on the bus for public tables', async () => {
    db.table.create.mockResolvedValue(baseTable)
    const app = makeApp()
    await request(app).post('/api/v1/tables').send({ gameId: 'xo', minPlayers: 2, maxPlayers: 2 })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'table.created',
      targets: { broadcast: true },
      payload: { tableId: 'tbl_1', gameId: 'xo', maxPlayers: 2 },
    })
  })

  it('does NOT dispatch for private tables (share-link only)', async () => {
    db.table.create.mockResolvedValue({ ...baseTable, isPrivate: true })
    const app = makeApp()
    await request(app).post('/api/v1/tables').send({ gameId: 'xo', minPlayers: 2, maxPlayers: 2, isPrivate: true })
    expect(dispatch).not.toHaveBeenCalled()
  })
})

// ── GET /api/v1/tables — list ─────────────────────────────────────────────────

describe('GET /api/v1/tables', () => {
  it('lists public tables only for guests (unauthenticated default)', async () => {
    db.table.findMany.mockResolvedValue([baseTable])
    const app = makeApp()
    const res = await request(app).get('/api/v1/tables')
    expect(res.status).toBe(200)
    expect(res.body.tables).toHaveLength(1)
    // optionalAuth sets req.auth = null by default in the mock, so guest path
    expect(db.table.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isPrivate: false },
    }))
  })

  it('authed default returns public + caller-owned (including private)', async () => {
    optionalAuth.mockImplementationOnce((req, _res, next) => {
      req.auth = { userId: 'ba_user_1' }
      next()
    })
    db.table.findMany.mockResolvedValue([baseTable])
    const app = makeApp()
    const res = await request(app).get('/api/v1/tables')
    expect(res.status).toBe(200)
    expect(db.table.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { isPrivate: false },
          { createdById: 'ba_user_1' },
        ],
      },
    }))
  })

  it('?mine=true requires auth (401 for guests)', async () => {
    const app = makeApp()
    const res = await request(app).get('/api/v1/tables?mine=true')
    expect(res.status).toBe(401)
  })

  it('?mine=true returns caller-owned tables when authed', async () => {
    optionalAuth.mockImplementationOnce((req, _res, next) => {
      req.auth = { userId: 'ba_user_1' }
      next()
    })
    db.table.findMany.mockResolvedValue([{ ...baseTable, isPrivate: true }])
    const app = makeApp()
    const res = await request(app).get('/api/v1/tables?mine=true')
    expect(res.status).toBe(200)
    expect(db.table.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { createdById: 'ba_user_1' },
    }))
  })

  it('honors ?status, ?gameId, ?limit', async () => {
    db.table.findMany.mockResolvedValue([])
    const app = makeApp()
    await request(app).get('/api/v1/tables?status=ACTIVE&gameId=connect4&limit=5')
    expect(db.table.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isPrivate: false, status: 'ACTIVE', gameId: 'connect4' },
      take: 5,
    }))
  })

  it('clamps limit to max 200', async () => {
    db.table.findMany.mockResolvedValue([])
    const app = makeApp()
    await request(app).get('/api/v1/tables?limit=9999')
    expect(db.table.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }))
  })

  it('enriches occupied seats with displayName/avatarUrl from User', async () => {
    db.table.findMany.mockResolvedValue([{
      ...baseTable,
      seats: [
        { userId: 'ba_user_1', status: 'occupied' },
        { userId: null,        status: 'empty'    },
      ],
    }])
    db.user.findMany.mockResolvedValueOnce([
      { betterAuthId: 'ba_user_1', displayName: 'Joe Pruskowski', avatarUrl: 'https://example/a.png', isBot: false },
    ])
    const app = makeApp()
    const res = await request(app).get('/api/v1/tables')
    expect(res.status).toBe(200)
    expect(res.body.tables[0].seats[0]).toEqual({
      userId:      'ba_user_1',
      status:      'occupied',
      displayName: 'Joe Pruskowski',
      avatarUrl:   'https://example/a.png',
      isBot:       false,
    })
    // Empty seats left untouched
    expect(res.body.tables[0].seats[1]).toEqual({ userId: null, status: 'empty' })
    // One hydration query, no N+1
    expect(db.user.findMany).toHaveBeenCalledTimes(1)
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { betterAuthId: { in: ['ba_user_1'] } },
    }))
  })
})

// ── GET /api/v1/tables/:id — get one ──────────────────────────────────────────

describe('GET /api/v1/tables/:id', () => {
  it('returns the table when found (including private)', async () => {
    db.table.findUnique.mockResolvedValue({ ...baseTable, isPrivate: true })
    const app = makeApp()
    const res = await request(app).get('/api/v1/tables/tbl_1')
    expect(res.status).toBe(200)
    expect(res.body.table.id).toBe('tbl_1')
    expect(res.body.table.isPrivate).toBe(true)  // private accessible by direct URL
  })

  it('returns 404 when not found', async () => {
    db.table.findUnique.mockResolvedValue(null)
    const app = makeApp()
    const res = await request(app).get('/api/v1/tables/nope')
    expect(res.status).toBe(404)
  })
})

// ── POST /api/v1/tables/:id/join ──────────────────────────────────────────────

describe('POST /api/v1/tables/:id/join', () => {
  it('seats the caller in the first empty seat', async () => {
    db.table.findUnique.mockResolvedValue(baseTable)
    db.table.update.mockImplementation(({ data }) => Promise.resolve({ ...baseTable, ...data }))
    const app = makeApp()
    const res = await request(app).post('/api/v1/tables/tbl_1/join')
    expect(res.status).toBe(200)
    expect(res.body.seated).toBe(true)
    expect(db.table.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tbl_1' },
      data: {
        seats: [
          { userId: 'ba_user_1', status: 'occupied' },
          { userId: null, status: 'empty' },
        ],
      },
    }))
    // Bus broadcasts player.joined so list + detail pages (and any second
    // tab of the joiner, and signed-out spectators) all refresh. The payload
    // carries stakeholders + actorDisplayName so AppLayout can surface a
    // scoped notification without a round trip.
    expect(dispatch).toHaveBeenCalledWith({
      type: 'player.joined',
      targets: { broadcast: true },
      payload: {
        tableId:          'tbl_1',
        gameId:           'xo',
        userId:           'ba_user_1',
        seatIndex:        0,
        stakeholders:     ['ba_user_1'],     // creator + newly-seated (same user here)
        actorDisplayName: null,              // mock returns null
      },
    })
  })

  it('seats the caller at the requested seatIndex when provided', async () => {
    db.table.findUnique.mockResolvedValue({
      ...baseTable,
      maxPlayers: 3,
      seats: [
        { userId: null, status: 'empty' },
        { userId: null, status: 'empty' },
        { userId: null, status: 'empty' },
      ],
    })
    db.table.update.mockImplementation(({ data }) => Promise.resolve({ ...baseTable, ...data }))
    const app = makeApp()
    const res = await request(app).post('/api/v1/tables/tbl_1/join').send({ seatIndex: 2 })
    expect(res.status).toBe(200)
    expect(db.table.update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        seats: [
          { userId: null, status: 'empty' },
          { userId: null, status: 'empty' },
          { userId: 'ba_user_1', status: 'occupied' },
        ],
      },
    }))
  })

  it('returns 409 when the requested seatIndex is already occupied', async () => {
    db.table.findUnique.mockResolvedValue({
      ...baseTable,
      seats: [
        { userId: 'somebody', status: 'occupied' },
        { userId: null,       status: 'empty' },
      ],
    })
    const app = makeApp()
    const res = await request(app).post('/api/v1/tables/tbl_1/join').send({ seatIndex: 0 })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already occupied/i)
    expect(db.table.update).not.toHaveBeenCalled()
  })

  it('returns 400 when seatIndex is out of range', async () => {
    db.table.findUnique.mockResolvedValue(baseTable)
    const app = makeApp()
    const res = await request(app).post('/api/v1/tables/tbl_1/join').send({ seatIndex: 99 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/out of range/i)
  })

  it('is idempotent — returns 200 without updating when already seated', async () => {
    db.table.findUnique.mockResolvedValue({
      ...baseTable,
      seats: [
        { userId: 'ba_user_1', status: 'occupied' },
        { userId: null, status: 'empty' },
      ],
    })
    const app = makeApp()
    const res = await request(app).post('/api/v1/tables/tbl_1/join')
    expect(res.status).toBe(200)
    expect(res.body.seated).toBe(true)
    expect(db.table.update).not.toHaveBeenCalled()
  })

  it('returns 409 when the table is full', async () => {
    db.table.findUnique.mockResolvedValue({
      ...baseTable,
      seats: [
        { userId: 'ba_user_2', status: 'occupied' },
        { userId: 'ba_user_3', status: 'occupied' },
      ],
    })
    const app = makeApp()
    const res = await request(app).post('/api/v1/tables/tbl_1/join')
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/full/i)
  })

  it('returns 409 when status is not FORMING', async () => {
    db.table.findUnique.mockResolvedValue({ ...baseTable, status: 'ACTIVE' })
    const app = makeApp()
    const res = await request(app).post('/api/v1/tables/tbl_1/join')
    expect(res.status).toBe(409)
  })

  it('returns 404 when the table does not exist', async () => {
    db.table.findUnique.mockResolvedValue(null)
    const app = makeApp()
    const res = await request(app).post('/api/v1/tables/nope/join')
    expect(res.status).toBe(404)
  })
})

// ── POST /api/v1/tables/:id/leave ─────────────────────────────────────────────

describe('POST /api/v1/tables/:id/leave', () => {
  it('vacates the caller seat', async () => {
    db.table.findUnique.mockResolvedValue({
      ...baseTable,
      seats: [
        { userId: 'ba_user_1', status: 'occupied' },
        { userId: 'ba_user_2', status: 'occupied' },
      ],
    })
    db.table.update.mockImplementation(({ data }) => Promise.resolve({ ...baseTable, ...data }))
    const app = makeApp()
    const res = await request(app).post('/api/v1/tables/tbl_1/leave')
    expect(res.status).toBe(200)
    expect(res.body.seated).toBe(false)
    expect(db.table.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tbl_1' },
      data: {
        seats: [
          { userId: null, status: 'empty' },
          { userId: 'ba_user_2', status: 'occupied' },
        ],
      },
    }))
    // Other player is still seated → table.empty NOT fired
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'table.empty' }))
    // Every leave broadcasts player.left so other open views refresh. The
    // creator (ba_user_1, self here) + remaining-seated (ba_user_2) are the
    // stakeholders the client-side notification filter will match on.
    expect(dispatch).toHaveBeenCalledWith({
      type: 'player.left',
      targets: { broadcast: true },
      payload: {
        tableId:          'tbl_1',
        gameId:           'xo',
        userId:           'ba_user_1',
        seatIndex:        0,
        stakeholders:     ['ba_user_1', 'ba_user_2'],
        actorDisplayName: null,
      },
    })
  })

  it('fires table.empty when the last seated player leaves a FORMING table', async () => {
    db.table.findUnique.mockResolvedValue({
      ...baseTable,
      seats: [
        { userId: 'ba_user_1', status: 'occupied' },
        { userId: null, status: 'empty' },
      ],
    })
    db.table.update.mockImplementation(({ data }) => Promise.resolve({ ...baseTable, ...data }))
    const app = makeApp()
    await request(app).post('/api/v1/tables/tbl_1/leave')
    expect(dispatch).toHaveBeenCalledWith({
      type: 'table.empty',
      targets: { cohort: ['ba_user_1'] },
      payload: { tableId: 'tbl_1' },
    })
    // player.left also fires on every leave regardless of occupancy.
    expect(dispatch).toHaveBeenCalledWith({
      type: 'player.left',
      targets: { broadcast: true },
      payload: {
        tableId:          'tbl_1',
        gameId:           'xo',
        userId:           'ba_user_1',
        seatIndex:        0,
        stakeholders:     ['ba_user_1'],     // creator only (nobody left seated)
        actorDisplayName: null,
      },
    })
  })

  it('is a no-op (200) when the caller was not seated', async () => {
    db.table.findUnique.mockResolvedValue(baseTable)
    const app = makeApp()
    const res = await request(app).post('/api/v1/tables/tbl_1/leave')
    expect(res.status).toBe(200)
    expect(res.body.seated).toBe(false)
    expect(db.table.update).not.toHaveBeenCalled()
  })

  it('returns 404 when the table does not exist', async () => {
    db.table.findUnique.mockResolvedValue(null)
    const app = makeApp()
    const res = await request(app).post('/api/v1/tables/nope/leave')
    expect(res.status).toBe(404)
  })
})

// ── DELETE /api/v1/tables/:id ─────────────────────────────────────────────────

describe('DELETE /api/v1/tables/:id', () => {
  it('creator can delete a FORMING table', async () => {
    db.table.findUnique.mockResolvedValue({ ...baseTable, createdById: 'ba_user_1' })
    db.table.delete.mockResolvedValue({})
    const app = makeApp()
    const res = await request(app).delete('/api/v1/tables/tbl_1')
    expect(res.status).toBe(204)
    expect(db.table.delete).toHaveBeenCalledWith({ where: { id: 'tbl_1' } })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'table.deleted',
      targets: { broadcast: true },
      payload: { tableId: 'tbl_1', gameId: 'xo' },
    }))
  })

  it('creator can delete a COMPLETED table', async () => {
    db.table.findUnique.mockResolvedValue({ ...baseTable, createdById: 'ba_user_1', status: 'COMPLETED' })
    db.table.delete.mockResolvedValue({})
    const app = makeApp()
    const res = await request(app).delete('/api/v1/tables/tbl_1')
    expect(res.status).toBe(204)
  })

  it('returns 403 when the caller is not the creator', async () => {
    db.table.findUnique.mockResolvedValue({ ...baseTable, createdById: 'someone_else' })
    const app = makeApp()
    const res = await request(app).delete('/api/v1/tables/tbl_1')
    expect(res.status).toBe(403)
    expect(db.table.delete).not.toHaveBeenCalled()
  })

  it('returns 403 on tournament-generated tables', async () => {
    db.table.findUnique.mockResolvedValue({ ...baseTable, createdById: 'ba_user_1', isTournament: true })
    const app = makeApp()
    const res = await request(app).delete('/api/v1/tables/tbl_1')
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/tournament/i)
  })

  it('returns 409 when the table is ACTIVE (mid-game)', async () => {
    db.table.findUnique.mockResolvedValue({ ...baseTable, createdById: 'ba_user_1', status: 'ACTIVE' })
    const app = makeApp()
    const res = await request(app).delete('/api/v1/tables/tbl_1')
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/active/i)
  })

  it('returns 404 when the table does not exist', async () => {
    db.table.findUnique.mockResolvedValue(null)
    const app = makeApp()
    const res = await request(app).delete('/api/v1/tables/nope')
    expect(res.status).toBe(404)
  })
})
