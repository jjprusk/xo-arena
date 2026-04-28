import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

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

import db from '../../lib/db.js'
import * as sseSessions from '../../realtime/sseSessions.js'
import * as tablePresence from '../../realtime/tablePresence.js'
import { dispatch as dispatchBus } from '../../lib/notificationBus.js'
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
  tablePresence._resetForTests()
})

// ─── POST /api/v1/rt/tables/:tableId/watch ───────────────────────────────────

describe('POST /api/v1/rt/tables/:tableId/watch', () => {
  it('409s when X-SSE-Session header is missing', async () => {
    const { app } = makeApp()
    const res = await request(app).post('/api/v1/rt/tables/tbl_1/watch').send({})
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('SSE_SESSION_MISSING')
  })

  it('404s when the table does not exist', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.table.findUnique.mockResolvedValueOnce(null)

    const res = await request(app)
      .post('/api/v1/rt/tables/missing/watch')
      .set('X-SSE-Session', 's1')
      .send({})
    expect(res.status).toBe(404)
  })

  it('registers the session as a watcher and dual-emits presence', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.table.findUnique
      .mockResolvedValueOnce({ id: 'tbl_1' })   // route existence check
      .mockResolvedValueOnce({                   // service cohort lookup
        seats: [
          { status: 'occupied', userId: 'p1' },
          { status: 'occupied', userId: 'p2' },
        ],
        isDemo: false,
      })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', displayName: 'Spec', username: 'spec',
    })

    const res = await request(app)
      .post('/api/v1/rt/tables/tbl_1/watch')
      .set('X-SSE-Session', 's1')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.tableId).toBe('tbl_1')
    expect(res.body.count).toBe(1)

    // SSE dual-emit on presence channel
    const presenceCalls = mockAppendToStream.mock.calls.filter(
      ([ch]) => ch === 'tbl_1:presence' || ch === 'table:tbl_1:presence',
    )
    expect(presenceCalls.length).toBeGreaterThanOrEqual(1)
    expect(presenceCalls[0][0]).toBe('table:tbl_1:presence')
    expect(presenceCalls[0][1].count).toBe(1)

    // Session tracked the join
    expect(sseSessions.tablesFor('s1')).toContain('tbl_1')

    // Bus dispatch fired with cohort = currently-seated players
    expect(dispatchBus).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'spectator.joined',
        targets: { cohort: ['p1', 'p2'] },
        payload: { tableId: 'tbl_1', userId: 'user_1' },
      }),
    )
  })

  it('skips bus dispatch when no players are seated', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    db.table.findUnique
      .mockResolvedValueOnce({ id: 'tbl_1' })
      .mockResolvedValueOnce({ seats: [], isDemo: false })
    db.user.findUnique.mockResolvedValueOnce({
      id: 'user_1', displayName: 'Spec',
    })

    await request(app)
      .post('/api/v1/rt/tables/tbl_1/watch')
      .set('X-SSE-Session', 's1')
      .send({})

    expect(dispatchBus).not.toHaveBeenCalled()
  })

  it('skips bus dispatch when the watcher is anonymous', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: null })
    db.table.findUnique.mockResolvedValueOnce({ id: 'tbl_1' })
    // Anonymous: no req.auth.userId path runs db.user.findUnique anyway,
    // but the requireAuth mock above always sets req.auth — so the route
    // attempts to look up the user; return null so the watcher is added
    // with null userId/displayName.
    db.user.findUnique.mockResolvedValueOnce(null)

    const res = await request(app)
      .post('/api/v1/rt/tables/tbl_1/watch')
      .set('X-SSE-Session', 's1')
      .send({})
    expect(res.status).toBe(200)
    expect(dispatchBus).not.toHaveBeenCalled()
  })
})

// ─── DELETE /api/v1/rt/tables/:tableId/watch ─────────────────────────────────

describe('DELETE /api/v1/rt/tables/:tableId/watch', () => {
  it('removes the watcher and dual-emits presence on success', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })
    // Pre-populate the watcher via the addWatcher helper directly so we
    // isolate the DELETE behavior from POST.
    tablePresence.addWatcher('tbl_1', 's1', { userId: 'user_1' })
    sseSessions.joinTable('s1', 'tbl_1')

    const res = await request(app)
      .delete('/api/v1/rt/tables/tbl_1/watch')
      .set('X-SSE-Session', 's1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ tableId: 'tbl_1', removed: true })

    expect(tablePresence.getPresence('tbl_1').count).toBe(0)
    expect(sseSessions.tablesFor('s1')).not.toContain('tbl_1')

    // Presence rebroadcast on SSE
    const presenceCalls = mockAppendToStream.mock.calls.filter(
      ([ch]) => ch === 'table:tbl_1:presence',
    )
    expect(presenceCalls).toHaveLength(1)
    expect(presenceCalls[0][1].count).toBe(0)
  })

  it('reports removed=false and skips broadcast when not watching', async () => {
    const { app } = makeApp()
    sseSessions.register('s1', { userId: 'user_1' })

    const res = await request(app)
      .delete('/api/v1/rt/tables/tbl_1/watch')
      .set('X-SSE-Session', 's1')
    expect(res.status).toBe(200)
    expect(res.body.removed).toBe(false)

    const presenceCalls = mockAppendToStream.mock.calls.filter(
      ([ch]) => ch === 'table:tbl_1:presence',
    )
    expect(presenceCalls).toHaveLength(0)
  })
})
