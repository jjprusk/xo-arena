import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Phase 7a: /rt/* routes now use optionalAuth globally. Tests that exercise
// the authenticated path expect a user in req.auth, so the mock attaches one.
// A separate "guest" test (where applicable) toggles the mock per-test.
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

vi.mock('../../lib/db.js', () => ({
  default: {
    user:  { findUnique: vi.fn() },
    table: { findUnique: vi.fn() },
  },
}))

vi.mock('../../services/skillService.js', () => ({
  getSystemConfig: vi.fn(async (_k, dflt) => dflt),
}))

vi.mock('../../services/tableService.js', () => ({
  handleIdlePong: vi.fn(),
}))

vi.mock('../../logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import db from '../../lib/db.js'
import * as sseSessions from '../../realtime/sseSessions.js'
import { handleIdlePong } from '../../services/tableService.js'
import realtimeRouter, { modeRouter } from '../realtime.js'

function makeApp() {
  const app = express()
  app.use(express.json())
  // Stand in for app.set('io') — the route reads it but the mocked
  // tableService doesn't actually use it.
  app.set('io', { mock: true })
  app.use('/api/v1/rt', realtimeRouter)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  sseSessions._resetForTests()
})

describe('POST /api/v1/rt/tables/:slug/idle/pong', () => {
  it('409s when X-SSE-Session header is missing', async () => {
    const app = makeApp()
    const res = await request(app)
      .post('/api/v1/rt/tables/abc/idle/pong')
      .send({})
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('SSE_SESSION_MISSING')
  })

  it('409s when X-SSE-Session is unknown to the registry', async () => {
    const app = makeApp()
    const res = await request(app)
      .post('/api/v1/rt/tables/abc/idle/pong')
      .set('X-SSE-Session', 'ghost')
      .send({})
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('SSE_SESSION_EXPIRED')
  })

  it('emits Fly-Replay when sessionId pins to a different machine', async () => {
    const orig = process.env.FLY_MACHINE_ID
    process.env.FLY_MACHINE_ID = 'machineA'
    try {
      const app = makeApp()
      const res = await request(app)
        .post('/api/v1/rt/tables/abc/idle/pong')
        .set('X-SSE-Session', 'machineB.someid')
        .send({})
      expect(res.status).toBe(200)
      expect(res.headers['fly-replay']).toBe('instance=machineB')
      expect(res.body).toEqual({ replay: 'machineB' })
    } finally {
      if (orig === undefined) delete process.env.FLY_MACHINE_ID
      else process.env.FLY_MACHINE_ID = orig
    }
  })

  it('falls through to local lookup when sessionId pins to this machine', async () => {
    const orig = process.env.FLY_MACHINE_ID
    process.env.FLY_MACHINE_ID = 'machineA'
    try {
      const app = makeApp()
      // No registered session — should still 409 EXPIRED, not replay.
      const res = await request(app)
        .post('/api/v1/rt/tables/abc/idle/pong')
        .set('X-SSE-Session', 'machineA.unknownid')
        .send({})
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('SSE_SESSION_EXPIRED')
    } finally {
      if (orig === undefined) delete process.env.FLY_MACHINE_ID
      else process.env.FLY_MACHINE_ID = orig
    }
  })

  it('returns 200 + ok=true when handleIdlePong succeeds', async () => {
    const app = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({ id: 'user_1' })
    handleIdlePong.mockResolvedValueOnce({ ok: true, tableId: 'tbl_1', isPlayer: true })

    const res = await request(app)
      .post('/api/v1/rt/tables/abc/idle/pong')
      .set('X-SSE-Session', 's1')
      .send({})

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(handleIdlePong).toHaveBeenCalledWith({
      io:     { mock: true },
      userId: 'user_1',
      slug:   'abc',
    })
  })

  it('404s when the table is not found', async () => {
    const app = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({ id: 'user_1' })
    handleIdlePong.mockResolvedValueOnce({ ok: false, reason: 'not-found' })

    const res = await request(app)
      .post('/api/v1/rt/tables/abc/idle/pong')
      .set('X-SSE-Session', 's1')
      .send({})

    expect(res.status).toBe(404)
  })

  it('410s when the table is no longer ACTIVE', async () => {
    const app = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({ id: 'user_1' })
    handleIdlePong.mockResolvedValueOnce({ ok: false, reason: 'not-active' })

    const res = await request(app)
      .post('/api/v1/rt/tables/abc/idle/pong')
      .set('X-SSE-Session', 's1')
      .send({})

    expect(res.status).toBe(410)
  })

  it('409s when the user has no active socket on this table', async () => {
    const app = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.user.findUnique.mockResolvedValueOnce({ id: 'user_1' })
    handleIdlePong.mockResolvedValueOnce({ ok: false, reason: 'no-session' })

    const res = await request(app)
      .post('/api/v1/rt/tables/abc/idle/pong')
      .set('X-SSE-Session', 's1')
      .send({})

    expect(res.status).toBe(409)
  })
})

describe('GET /api/v1/realtime/mode', () => {
  it('returns transport + perFeature defaults', async () => {
    const app = express()
    app.use('/api/v1/realtime', modeRouter)

    const res = await request(app).get('/api/v1/realtime/mode')
    expect(res.status).toBe(200)
    expect(res.body.transport).toBe('socketio')
    expect(res.body.perFeature).toBeDefined()
    expect(res.body.perFeature.idle).toBeNull()
  })
})
