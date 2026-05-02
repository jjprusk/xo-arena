import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Phase 7a: /rt/* routes now use optionalAuth globally. Pong specifically
// supports guests, so the mock attaches `req.auth = null` by default —
// individual tests can override if they need the authed branch.
vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.auth = { userId: 'ba_user_1' }
    next()
  },
  optionalAuth: (req, _res, next) => { req.auth = null; next() },
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    user:  { findUnique: vi.fn() },
    table: { findUnique: vi.fn() },
  },
}))

vi.mock('../../services/skillService.js', () => ({
  getSystemConfig: vi.fn(async (_k, dflt) => dflt),
}))

vi.mock('../../services/tableService.js', () => ({ handleIdlePong: vi.fn() }))

vi.mock('../../services/tournamentMatchService.js', () => ({
  joinMatchTable: vi.fn(),
  TournamentMatchError: class TournamentMatchError extends Error {
    constructor(code, msg) { super(msg ?? code); this.code = code }
  },
}))

vi.mock('../../services/journeyService.js', () => ({
  completeStep: vi.fn(),
}))

vi.mock('../../lib/notificationBus.js', () => ({
  dispatch: vi.fn().mockResolvedValue(undefined),
}))

const { mockAppendToStream } = vi.hoisted(() => ({
  mockAppendToStream: vi.fn().mockResolvedValue('1-0'),
}))
vi.mock('../../lib/eventStream.js', () => ({ appendToStream: mockAppendToStream }))

vi.mock('../../logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import * as sseSessions from '../../realtime/sseSessions.js'
import * as pongRunner from '../../realtime/pongRunner.js'
import realtimeRouter from '../realtime.js'

function makeApp() {
  const mockIo = { to: vi.fn().mockReturnThis(), emit: vi.fn() }
  const app = express()
  app.use(express.json())
  app.set('io', mockIo)
  app.use('/api/v1/rt', realtimeRouter)
  return { app, mockIo }
}

beforeEach(() => {
  vi.clearAllMocks()
  sseSessions._resetForTests()
  // Pong runner has process-level state (rooms map). Tests share a process,
  // so use unique slugs per test instead of resetting the runner.
})

// ─── POST /api/v1/rt/pong/rooms ──────────────────────────────────────────────

describe('POST /api/v1/rt/pong/rooms', () => {
  it('409s when X-SSE-Session header is missing', async () => {
    const { app } = makeApp()
    const res = await request(app)
      .post('/api/v1/rt/pong/rooms')
      .send({ slug: 'pong-test-1' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('SSE_SESSION_MISSING')
  })

  it('400s when slug is missing', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    const res = await request(app)
      .post('/api/v1/rt/pong/rooms')
      .set('X-SSE-Session', 's1')
      .send({})
    expect(res.status).toBe(400)
  })

  it('creates the room and seats the caller as P1', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    const slug = 'pong-test-create-1'
    const res = await request(app)
      .post('/api/v1/rt/pong/rooms')
      .set('X-SSE-Session', 's1')
      .send({ slug })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ slug, playerIndex: 0 })
    expect(sseSessions.pongRoomsFor('s1')).toContain(slug)
    expect(pongRunner.hasRoom(slug)).toBe(true)
  })
})

// ─── POST /api/v1/rt/pong/rooms/:slug/join ───────────────────────────────────

describe('POST /api/v1/rt/pong/rooms/:slug/join', () => {
  it('seats the second caller as P2 and starts the game loop (lifecycle dual-emit)', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    sseSessions.register('s2', { userId: 'user_2' })
    const slug = 'pong-test-join-1'

    // P1 creates
    await request(app)
      .post('/api/v1/rt/pong/rooms')
      .set('X-SSE-Session', 's1')
      .send({ slug })

    // P2 joins
    const res = await request(app)
      .post(`/api/v1/rt/pong/rooms/${slug}/join`)
      .set('X-SSE-Session', 's2')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.slug).toBe(slug)
    expect(res.body.playerIndex).toBe(1)
    expect(res.body.spectating).toBe(false)
    expect(res.body.state).toBeTruthy()

    // Lifecycle dual-emit: pongRunner.startLoop fires `pong:<slug>:lifecycle`
    // with kind=started.
    const lifecycleCalls = mockAppendToStream.mock.calls.filter(
      ([ch]) => ch === `pong:${slug}:lifecycle`,
    )
    expect(lifecycleCalls.length).toBeGreaterThanOrEqual(1)
    expect(lifecycleCalls[0][1].kind).toBe('started')

    // Stop the tick loop so it doesn't spam appendToStream during the rest
    // of the suite.
    pongRunner.removeSocket('s1')
  })

  it('joins a non-existent room by creating it on demand (legacy parity)', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    const slug = 'pong-test-join-ondemand'

    const res = await request(app)
      .post(`/api/v1/rt/pong/rooms/${slug}/join`)
      .set('X-SSE-Session', 's1')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.playerIndex).toBe(0)
    expect(pongRunner.hasRoom(slug)).toBe(true)
  })
})

// ─── POST /api/v1/rt/pong/rooms/:slug/input ──────────────────────────────────

describe('POST /api/v1/rt/pong/rooms/:slug/input', () => {
  it('returns 204 on a valid input', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    sseSessions.register('s2', { userId: 'user_2' })
    const slug = 'pong-test-input-1'

    await request(app)
      .post('/api/v1/rt/pong/rooms')
      .set('X-SSE-Session', 's1')
      .send({ slug })
    await request(app)
      .post(`/api/v1/rt/pong/rooms/${slug}/join`)
      .set('X-SSE-Session', 's2')
      .send({})

    const res = await request(app)
      .post(`/api/v1/rt/pong/rooms/${slug}/input`)
      .set('X-SSE-Session', 's1')
      .send({ direction: 'up' })
    expect(res.status).toBe(204)

    pongRunner.removeSocket('s1')
  })

  it('400s when direction is missing', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    const res = await request(app)
      .post('/api/v1/rt/pong/rooms/anything/input')
      .set('X-SSE-Session', 's1')
      .send({})
    expect(res.status).toBe(400)
  })
})
