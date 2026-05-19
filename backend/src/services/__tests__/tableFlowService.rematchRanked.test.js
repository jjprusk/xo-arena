// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * tableFlowService.rematchRankedTableInPlace — A2.4 unit tests.
 *
 * The helper resets the ranked HvB table for game 2 of a BO2 — clears the
 * board, swaps marks (human X → O, bot O → X), bumps the round, and keeps
 * the same Table row. The DB layer is mocked so behavior can be exercised
 * without standing up a real schema.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/db.js', () => ({
  default: {
    table: { findFirst: vi.fn(), update: vi.fn() },
  },
}))

const evt = vi.hoisted(() => ({
  appendToStream: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../lib/eventStream.js', () => evt)

// The source uses a lazy dynamic import('../realtime/socketHandler.js') to
// fetch dispatchBotMove + friends. Mock the whole module so the import resolves
// without booting the real handler graph. We don't assert on dispatch counts —
// the .catch() in the source intentionally swallows any failure here, and the
// e2e covers the live bot-opening path.
vi.mock('../../realtime/socketHandler.js', () => ({
  dispatchBotMove: vi.fn().mockResolvedValue(undefined),
}))

import db from '../../lib/db.js'
import { rematchRankedTableInPlace } from '../tableFlowService.js'

const HUMAN_SEAT = 'ba_alice'
const BOT_SEAT   = 'bot_rusty'

function existingTable(overrides = {}) {
  return {
    id: 'tbl_r1',
    matchId: 'm1',
    status: 'ACTIVE',
    seats: [
      { userId: HUMAN_SEAT, status: 'occupied', displayName: 'Alice' },
      { userId: BOT_SEAT,   status: 'occupied', displayName: 'Rusty' },
    ],
    previewState: {
      board: Array(9).fill('X'),
      currentTurn: 'X',
      scores: { X: 1, O: 0 },
      round: 1,
      winner: 'X',
      winLine: [0, 1, 2],
      marks: { [HUMAN_SEAT]: 'X', [BOT_SEAT]: 'O' },
      botMark: 'O',
      moves: [],
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('rematchRankedTableInPlace — argument validation', () => {
  it('throws when matchId is missing', async () => {
    await expect(rematchRankedTableInPlace({ matchId: '', nextSpawn: { sequence: 2 } }))
      .rejects.toThrow(/matchId required/)
  })

  it('throws when nextSpawn is missing', async () => {
    await expect(rematchRankedTableInPlace({ matchId: 'm1', nextSpawn: null }))
      .rejects.toThrow(/nextSpawn required/)
  })
})

describe('rematchRankedTableInPlace — happy path', () => {
  it('returns null when no table with the matchId is found', async () => {
    db.table.findFirst.mockResolvedValueOnce(null)
    const r = await rematchRankedTableInPlace({
      matchId: 'm_missing',
      nextSpawn: { sequence: 2, firstMoverId: 'p2', secondMoverId: 'p1', p1IsFirstMover: false },
    })
    expect(r).toBeNull()
    expect(db.table.update).not.toHaveBeenCalled()
  })

  it('swaps human X → O and bot O → X for game 2, clears the board, bumps the round', async () => {
    db.table.findFirst.mockResolvedValueOnce(existingTable())
    db.table.update.mockImplementation(({ data }) => Promise.resolve({ id: 'tbl_r1', ...data }))

    const r = await rematchRankedTableInPlace({
      matchId: 'm1',
      nextSpawn: { sequence: 2, firstMoverId: 'p2', secondMoverId: 'p1', p1IsFirstMover: false },
    })

    expect(r).not.toBeNull()
    expect(r.humanMark).toBe('O')
    expect(r.botMark).toBe('X')
    expect(r.previewState).toMatchObject({
      board:       Array(9).fill(null),
      currentTurn: 'X',
      round:       2,
      winner:      null,
      winLine:     null,
      moves:       [],
      marks:       { [HUMAN_SEAT]: 'O', [BOT_SEAT]: 'X' },
      botMark:     'X',
    })
    // Same table row — update, not create.
    expect(db.table.update).toHaveBeenCalledWith({
      where: { id: 'tbl_r1' },
      data:  { status: 'ACTIVE', previewState: expect.any(Object) },
    })
  })

  it('handles the inverse — human had O in game 1, gets X in game 2', async () => {
    db.table.findFirst.mockResolvedValueOnce(existingTable({
      previewState: {
        ...existingTable().previewState,
        marks: { [HUMAN_SEAT]: 'O', [BOT_SEAT]: 'X' },
        botMark: 'X',
      },
    }))
    db.table.update.mockImplementation(({ data }) => Promise.resolve({ id: 'tbl_r1', ...data }))

    const r = await rematchRankedTableInPlace({
      matchId: 'm1',
      nextSpawn: { sequence: 2, firstMoverId: 'p1', secondMoverId: 'p2', p1IsFirstMover: true },
    })

    expect(r.humanMark).toBe('X')
    expect(r.botMark).toBe('O')
    expect(r.previewState.marks).toEqual({ [HUMAN_SEAT]: 'X', [BOT_SEAT]: 'O' })
    expect(r.previewState.botMark).toBe('O')
  })

  it('emits a state.start event so subscribers flip out of phase=finished', async () => {
    db.table.findFirst.mockResolvedValueOnce(existingTable())
    db.table.update.mockImplementation(({ data }) => Promise.resolve({ id: 'tbl_r1', ...data }))

    await rematchRankedTableInPlace({
      matchId: 'm1',
      nextSpawn: { sequence: 2, firstMoverId: 'p2', secondMoverId: 'p1', p1IsFirstMover: false },
    })

    const startCall = evt.appendToStream.mock.calls.find(c => c[1]?.kind === 'start')
    expect(startCall).toBeDefined()
    expect(startCall[0]).toBe('table:tbl_r1:state')
    expect(startCall[1]).toMatchObject({
      kind:        'start',
      board:       Array(9).fill(null),
      currentTurn: 'X',
      round:       2,
    })
  })

  it('returns null if the table has malformed seats (defensive)', async () => {
    db.table.findFirst.mockResolvedValueOnce(existingTable({ seats: [{ userId: null }, { userId: null }] }))
    const r = await rematchRankedTableInPlace({
      matchId: 'm1',
      nextSpawn: { sequence: 2, firstMoverId: 'p2', secondMoverId: 'p1', p1IsFirstMover: false },
    })
    expect(r).toBeNull()
    expect(db.table.update).not.toHaveBeenCalled()
  })
})
