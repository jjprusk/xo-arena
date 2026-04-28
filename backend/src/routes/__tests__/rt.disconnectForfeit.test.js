// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Integration: a successful re-attach POST clears any pending forfeit timer.
 * Phase 7e wiring: routes/realtime.js calls cancelForfeitFor when joinTable
 * returns action='host_reattach' or 'reattached_active'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth:   (req, _res, next) => { req.auth = { userId: 'ba_user_1' }; next() },
  optionalAuth:  (req, _res, next) => { req.auth = { userId: 'ba_user_1' }; next() },
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    user:  { findUnique: vi.fn() },
    table: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
}))

vi.mock('../../services/skillService.js', () => ({
  getSystemConfig: vi.fn(async (_k, dflt) => dflt),
}))
vi.mock('../../services/tableService.js', () => ({ handleIdlePong: vi.fn() }))
vi.mock('../../services/tournamentMatchService.js', () => ({
  joinMatchTable: vi.fn(),
  TournamentMatchError: class extends Error { constructor(c, m) { super(m ?? c); this.code = c } },
}))

const flow = vi.hoisted(() => ({
  createPvpTable: vi.fn(), createHvbTable: vi.fn(), joinTable: vi.fn(),
  cancelTable: vi.fn(), applyMove: vi.fn(), forfeitGame: vi.fn(),
  leaveGame: vi.fn(), rematchGame: vi.fn(), sendReaction: vi.fn(),
}))
vi.mock('../../services/tableFlowService.js', () => flow)

const cancelForfeitForMock = vi.fn().mockReturnValue(true)
vi.mock('../../services/disconnectForfeitService.js', () => ({
  cancelForfeitFor: (...args) => cancelForfeitForMock(...args),
}))

vi.mock('../../lib/eventStream.js', () => ({ appendToStream: vi.fn().mockResolvedValue('1-0') }))
vi.mock('../../realtime/socketHandler.js', () => ({ dispatchBotMove: vi.fn() }))
vi.mock('../../logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import db from '../../lib/db.js'
import * as sseSessions from '../../realtime/sseSessions.js'
import realtimeRouter from '../realtime.js'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.set('io', { to: vi.fn().mockReturnThis(), emit: vi.fn() })
  app.use('/api/v1/rt', realtimeRouter)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  cancelForfeitForMock.mockClear().mockReturnValue(true)
  sseSessions._resetForTests()
  sseSessions.register('s1', { userId: 'user_1' })
  db.user.findUnique.mockResolvedValue({ id: 'user_1', betterAuthId: 'ba_user_1', displayName: 'A' })
})

describe('POST /api/v1/rt/tables/:slug/join — disconnect-forfeit cancellation', () => {
  it('cancels a pending forfeit timer when the service returns reattached_active', async () => {
    const app = makeApp()
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.joinTable.mockResolvedValueOnce({
      ok: true, action: 'reattached_active',
      table: { id: 'tbl_1' }, mark: 'X',
      room: { id: 'tbl_1', seats: [], previewState: {} },
      startPayload: { board: Array(9).fill(null), currentTurn: 'X', round: 1 },
    })

    const res = await request(app)
      .post('/api/v1/rt/tables/abc/join')
      .set('X-SSE-Session', 's1')
      .send({})

    expect(res.status).toBe(200)
    expect(cancelForfeitForMock).toHaveBeenCalledWith({ seatId: 'ba_user_1', tableId: 'tbl_1' })
  })

  it('cancels a pending forfeit timer when the service returns host_reattach', async () => {
    const app = makeApp()
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.joinTable.mockResolvedValueOnce({
      ok: true, action: 'host_reattach',
      table: { id: 'tbl_1' }, mark: 'X',
      room: { id: 'tbl_1', seats: [] },
    })

    await request(app)
      .post('/api/v1/rt/tables/abc/join')
      .set('X-SSE-Session', 's1')
      .send({})

    expect(cancelForfeitForMock).toHaveBeenCalledWith({ seatId: 'ba_user_1', tableId: 'tbl_1' })
  })

  it('does NOT call cancelForfeitFor on a fresh guest_seated join', async () => {
    const app = makeApp()
    db.table.findFirst.mockResolvedValueOnce({ id: 'tbl_1' })
    flow.joinTable.mockResolvedValueOnce({
      ok: true, action: 'guest_seated',
      table: { id: 'tbl_1' }, mark: 'O',
      room: { id: 'tbl_1', seats: [] },
    })

    await request(app)
      .post('/api/v1/rt/tables/abc/join')
      .set('X-SSE-Session', 's1')
      .send({})

    expect(cancelForfeitForMock).not.toHaveBeenCalled()
  })
})
