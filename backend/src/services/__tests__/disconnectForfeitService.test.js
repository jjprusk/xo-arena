// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/db.js', () => ({
  default: {
    table: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    user:  { findUnique: vi.fn() },
  },
}))

vi.mock('../../lib/tableSeats.js', () => ({
  releaseSeats:        (seats) => seats?.map(s => ({ ...s, status: 'empty', userId: null })) ?? [],
  releaseSeatForUser:  (seats, userId) =>
    seats?.map(s => s?.userId === userId ? ({ ...s, status: 'empty', userId: null }) : s) ?? [],
}))

vi.mock('../../lib/tableReleased.js', () => ({
  TABLE_RELEASED_REASONS: { DISCONNECT: 'disconnect' },
  dispatchTableReleased:  vi.fn(),
}))

vi.mock('../../lib/tournamentBridge.js', () => ({
  deletePendingPvpMatch:  vi.fn(),
  setPendingPvpMatchSlug: vi.fn(),
}))

vi.mock('../tablePresenceService.js', () => ({
  dualEmitLifecycle: vi.fn(),
}))

vi.mock('../../lib/eventStream.js', () => ({
  appendToStream: vi.fn().mockResolvedValue('1-0'),
}))

vi.mock('../../realtime/socketHandler.js', () => ({
  recordPvpGame: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import db from '../../lib/db.js'
import * as sseSessions from '../../realtime/sseSessions.js'
import { dualEmitLifecycle } from '../tablePresenceService.js'
import { appendToStream } from '../../lib/eventStream.js'
import {
  handleDisconnect,
  cancelForfeitFor,
  _hasPendingForfeit,
  _RECONNECT_WINDOW_MS,
  _resetForTests,
} from '../disconnectForfeitService.js'

beforeEach(() => {
  vi.clearAllMocks()
  // Reset queued mockResolvedValueOnce values from previous tests so leftover
  // Once entries don't get consumed before this test's mocks.
  db.table.findUnique.mockReset()
  db.table.update.mockReset()
  db.table.delete.mockReset()
  db.user.findUnique.mockReset()
  vi.useFakeTimers()
  sseSessions._resetForTests()
  _resetForTests()
})
afterEach(() => { vi.useRealTimers() })

const FORMING_TABLE = {
  id: 'tbl_1', slug: 'abc', status: 'FORMING',
  createdById: 'ba_user_1',
  seats: [
    { userId: 'ba_user_1', status: 'occupied', displayName: 'Host' },
    { userId: null,        status: 'empty' },
  ],
  previewState: { marks: { ba_user_1: 'X' }, scores: { X: 0, O: 0 }, board: Array(9).fill(null), currentTurn: 'X' },
  tournamentMatchId: null,
}
const ACTIVE_TABLE = {
  ...FORMING_TABLE, status: 'ACTIVE',
  seats: [
    { userId: 'ba_user_1', status: 'occupied', displayName: 'Host'  },
    { userId: 'ba_user_2', status: 'occupied', displayName: 'Guest' },
  ],
  previewState: {
    marks: { ba_user_1: 'X', ba_user_2: 'O' },
    scores: { X: 0, O: 0 },
    board: Array(9).fill(null),
    currentTurn: 'X',
  },
}

describe('disconnectForfeitService.handleDisconnect', () => {
  it('FORMING table: closes immediately and emits cancelled lifecycle', async () => {
    db.table.findUnique.mockResolvedValueOnce(FORMING_TABLE)
    db.user.findUnique.mockResolvedValueOnce({ betterAuthId: 'ba_user_1' })
    db.table.update.mockResolvedValueOnce({ ...FORMING_TABLE, status: 'COMPLETED' })

    await handleDisconnect({ io: null, userId: 'user_1', sessionId: 's1', tablesGone: ['tbl_1'] })

    expect(db.table.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tbl_1' },
      data:  expect.objectContaining({ status: 'COMPLETED' }),
    }))
    expect(dualEmitLifecycle).toHaveBeenCalledWith(null, 'tbl_1', 'cancelled')
  })

  it('ACTIVE table: emits playerDisconnected and schedules a forfeit timer', async () => {
    db.table.findUnique.mockResolvedValueOnce(ACTIVE_TABLE)
    db.user.findUnique.mockResolvedValueOnce({ betterAuthId: 'ba_user_1' })

    await handleDisconnect({ io: null, userId: 'user_1', sessionId: 's1', tablesGone: ['tbl_1'] })

    expect(dualEmitLifecycle).toHaveBeenCalledWith(null, 'tbl_1', 'playerDisconnected', expect.objectContaining({
      mark: 'X', reconnectWindowMs: _RECONNECT_WINDOW_MS,
    }))
    expect(_hasPendingForfeit({ seatId: 'ba_user_1', tableId: 'tbl_1' })).toBe(true)
    // No DB update yet — that's the timer's job.
    expect(db.table.update).not.toHaveBeenCalled()
  })

  it('ACTIVE table: timer firing closes the table and emits forfeit on SSE', async () => {
    // First lookup (handleDisconnect) + second lookup (timer fires).
    db.table.findUnique.mockResolvedValueOnce(ACTIVE_TABLE).mockResolvedValueOnce(ACTIVE_TABLE)
    db.user.findUnique.mockResolvedValue({ betterAuthId: 'ba_user_1' })
    db.table.update.mockResolvedValueOnce({ ...ACTIVE_TABLE, status: 'COMPLETED' })

    await handleDisconnect({ io: null, userId: 'user_1', sessionId: 's1', tablesGone: ['tbl_1'] })
    await vi.advanceTimersByTimeAsync(_RECONNECT_WINDOW_MS + 50)

    expect(db.table.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tbl_1' },
      data:  expect.objectContaining({ status: 'COMPLETED' }),
    }))
    expect(appendToStream).toHaveBeenCalledWith(
      'table:tbl_1:state',
      expect.objectContaining({ kind: 'forfeit', forfeiterMark: 'X', winner: 'O' }),
      { userId: '*' },
    )
    expect(_hasPendingForfeit({ seatId: 'ba_user_1', tableId: 'tbl_1' })).toBe(false)
  })

  it('cancelForfeitFor clears the pending timer (rejoin within the window)', async () => {
    db.table.findUnique.mockResolvedValueOnce(ACTIVE_TABLE).mockResolvedValueOnce(ACTIVE_TABLE)
    db.user.findUnique.mockResolvedValue({ betterAuthId: 'ba_user_1' })

    await handleDisconnect({ io: null, userId: 'user_1', sessionId: 's1', tablesGone: ['tbl_1'] })
    expect(_hasPendingForfeit({ seatId: 'ba_user_1', tableId: 'tbl_1' })).toBe(true)

    expect(cancelForfeitFor({ seatId: 'ba_user_1', tableId: 'tbl_1' })).toBe(true)

    // Even after the window elapses, no forfeit emit happens.
    await vi.advanceTimersByTimeAsync(_RECONNECT_WINDOW_MS + 50)
    expect(appendToStream).not.toHaveBeenCalledWith(
      'table:tbl_1:state',
      expect.objectContaining({ kind: 'forfeit' }),
      expect.anything(),
    )
  })

  it('skips the disconnect logic when the user has another live session at the same table', async () => {
    sseSessions.register('s2', { userId: 'user_1' })
    sseSessions.joinTable('s2', 'tbl_1')

    await handleDisconnect({ io: null, userId: 'user_1', sessionId: 's1', tablesGone: ['tbl_1'] })

    expect(db.table.findUnique).not.toHaveBeenCalled()
    expect(dualEmitLifecycle).not.toHaveBeenCalled()
  })

  it('both players gone: closes immediately and clears the opponent timer', async () => {
    db.table.findUnique
      .mockResolvedValueOnce(ACTIVE_TABLE)   // first dispose
      .mockResolvedValueOnce(ACTIVE_TABLE)   // second dispose
    db.user.findUnique
      .mockResolvedValueOnce({ betterAuthId: 'ba_user_1' })
      .mockResolvedValueOnce({ betterAuthId: 'ba_user_2' })

    await handleDisconnect({ io: null, userId: 'user_1', sessionId: 's1', tablesGone: ['tbl_1'] })
    expect(_hasPendingForfeit({ seatId: 'ba_user_1', tableId: 'tbl_1' })).toBe(true)

    await handleDisconnect({ io: null, userId: 'user_2', sessionId: 's2', tablesGone: ['tbl_1'] })
    expect(_hasPendingForfeit({ seatId: 'ba_user_1', tableId: 'tbl_1' })).toBe(false)
    expect(db.table.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETED' }),
    }))
  })

  it('guest seat (no userId) is resolved via guest:<sessionId> matching', async () => {
    const guestTable = {
      ...ACTIVE_TABLE,
      seats: [
        { userId: 'guest:s1',  status: 'occupied' },
        { userId: 'ba_user_2', status: 'occupied' },
      ],
      previewState: {
        marks: { 'guest:s1': 'X', ba_user_2: 'O' },
        scores: { X: 0, O: 0 }, board: Array(9).fill(null), currentTurn: 'X',
      },
    }
    db.table.findUnique.mockResolvedValueOnce(guestTable)

    await handleDisconnect({ io: null, userId: null, sessionId: 's1', tablesGone: ['tbl_1'] })

    expect(_hasPendingForfeit({ seatId: 'guest:s1', tableId: 'tbl_1' })).toBe(true)
    expect(dualEmitLifecycle).toHaveBeenCalledWith(null, 'tbl_1', 'playerDisconnected', expect.objectContaining({
      mark: 'X',
    }))
  })

  it('COMPLETED table: only frees the leaver seat, no forfeit fires', async () => {
    db.table.findUnique.mockResolvedValueOnce({ ...ACTIVE_TABLE, status: 'COMPLETED' })
    db.user.findUnique.mockResolvedValueOnce({ betterAuthId: 'ba_user_1' })
    db.table.update.mockResolvedValueOnce({ ...ACTIVE_TABLE, status: 'COMPLETED' })

    await handleDisconnect({ io: null, userId: 'user_1', sessionId: 's1', tablesGone: ['tbl_1'] })

    expect(db.table.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ status: expect.anything() }),
    }))
    expect(dualEmitLifecycle).not.toHaveBeenCalled()
  })
})
