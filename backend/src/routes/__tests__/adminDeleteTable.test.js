// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Chunk 3 F5: DELETE /api/v1/admin/tables/:id must drop in-memory state.
 *
 * The route flips Table.status to COMPLETED, releases seats, and dispatches
 * a `table.deleted` notification. Until F5 it left _socketToTable,
 * _disconnectTimers, etc. populated — those maps then held stale entries
 * until the next disconnect. This test pins the new contract: the route
 * calls unregisterTable(id) for the affected row.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth:  (req, _res, next) => { req.auth = { userId: 'ba_admin_1' }; next() },
  requireAdmin: (_req, _res, next) => next(),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    user:    { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    baUser:  { findMany: vi.fn() },
    game:    { count: vi.fn(), findMany: vi.fn() },
    botSkill: { count: vi.fn() },
    table: {
      findUnique: vi.fn(),
      update:     vi.fn(),
    },
  },
}))

vi.mock('../../services/skillService.js', () => ({
  deleteModel: vi.fn(), getSystemConfig: vi.fn(), setSystemConfig: vi.fn(),
}))

vi.mock('../../lib/notificationBus.js', () => ({
  dispatch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/eventStream.js', () => ({
  appendToStream: vi.fn().mockResolvedValue('1-0'),
}))

vi.mock('../../realtime/socketHandler.js', () => ({
  unregisterTable: vi.fn(),
}))

vi.mock('../../lib/tableReleased.js', () => ({
  dispatchTableReleased: vi.fn(),
  TABLE_RELEASED_REASONS: {
    DISCONNECT: 'disconnect', LEAVE: 'leave', GAME_END: 'game-end',
    GC_STALE:   'gc-stale',   GC_IDLE: 'gc-idle',
    ADMIN:      'admin',      GUEST_CLEANUP: 'guest-cleanup',
  },
}))

vi.mock('../../lib/resourceCounters.js', () => ({
  getSnapshots:         vi.fn(() => []),
  getLatestSnapshot:    vi.fn(),
  getAlerts:            vi.fn(() => ({})),
  getTableCreateErrors: vi.fn(() => ({ P2002: 0, P2003: 0, OTHER: 0 })),
  getGcStats:           vi.fn(() => ({ failures: 0, lastSuccessAt: null, secondsSinceLastSuccess: null })),
  getTableReleased:     vi.fn(() => ({
    disconnect: 0, leave: 0, 'game-end': 0,
    'gc-stale': 0, 'gc-idle': 0, admin: 0, 'guest-cleanup': 0, OTHER: 0,
  })),
}))

const adminRouter = (await import('../admin.js')).default
const db = (await import('../../lib/db.js')).default
const { unregisterTable } = await import('../../realtime/socketHandler.js')
const { dispatch } = await import('../../lib/notificationBus.js')
const { appendToStream } = await import('../../lib/eventStream.js')
const { dispatchTableReleased } = await import('../../lib/tableReleased.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/admin', adminRouter)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DELETE /api/v1/admin/tables/:id', () => {
  it('returns 404 when the table does not exist', async () => {
    db.table.findUnique.mockResolvedValue(null)
    const res = await request(makeApp()).delete('/api/v1/admin/tables/tbl_missing')
    expect(res.status).toBe(404)
    expect(unregisterTable).not.toHaveBeenCalled()
  })

  it('marks the table COMPLETED, releases seats, dispatches table.deleted, and drops in-memory state', async () => {
    db.table.findUnique.mockResolvedValue({
      id:    'tbl_1',
      slug:  'abc12345',
      status: 'ACTIVE',
      seats: [
        { userId: 'u_a', status: 'occupied', displayName: 'Alice' },
        { userId: 'u_b', status: 'occupied', displayName: 'Bob' },
      ],
      previewState: { scores: { X: 2, O: 1 } },
    })
    db.table.update.mockResolvedValue({})

    const res = await request(makeApp()).delete('/api/v1/admin/tables/tbl_1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })

    // F1: status flipped + every seat released
    expect(db.table.update).toHaveBeenCalledWith({
      where: { id: 'tbl_1' },
      data:  {
        status: 'COMPLETED',
        seats: [
          { userId: null, status: 'empty', displayName: null },
          { userId: null, status: 'empty', displayName: null },
        ],
      },
    })

    // forfeit state appended to the SSE channel with the live scores
    expect(appendToStream).toHaveBeenCalledWith(
      'table:tbl_1:state',
      expect.objectContaining({ kind: 'forfeit', winner: null, scores: { X: 2, O: 1 } }),
      { userId: '*' },
    )

    // bus event for the rest of the platform
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type:    'table.deleted',
      payload: expect.objectContaining({ tableId: 'tbl_1', slug: 'abc12345' }),
    }))

    // F5: in-memory pointers dropped for this table
    expect(unregisterTable).toHaveBeenCalledWith('tbl_1')

    // F6: per-reason release event fires with reason=admin
    expect(dispatchTableReleased).toHaveBeenCalledWith(
      'tbl_1', 'admin', expect.objectContaining({ trigger: 'admin-delete' }),
    )
  })
})
