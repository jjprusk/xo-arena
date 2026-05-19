// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * tableFlowService.rematchGame — A2.5 unit tests for the tournament-
 * aware color-rotation branch.
 *
 * Non-tournament rematches keep the legacy behavior (currentTurn flips,
 * marks stay). Tournament rematches derive marks from `assignColors` with
 * `TournamentMatch.id` as the seed; game 3 of a best-of-3+ series uses
 * the random tiebreaker variant and surfaces `previewState.tiebreaker:
 * true` so the realtime fan-out can announce it (A2.7).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/db.js', () => ({
  default: {
    table: { findUnique: vi.fn(), update: vi.fn() },
  },
}))

const evt = vi.hoisted(() => ({
  appendToStream: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../lib/eventStream.js', () => evt)

vi.mock('../../realtime/socketHandlerHelpers.js', () => ({
  // rematchGame only invokes this on the HvB bot-opening branch; HvH
  // tournaments don't touch it.
  getSocketHandlerHelpers: vi.fn(async () => ({ dispatchBotMove: vi.fn() })),
}))

import db from '../../lib/db.js'
import { rematchGame } from '../tableFlowService.js'

// Seed 'tm_a' has sha256 bit-0 == 0 → player1 (seat[0].userId) starts
// game 1. Pinned so the parity is unambiguous.
const TM_SEED_P1 = 'tm_a'

function existingTable(overrides = {}) {
  return {
    id: 'tbl_t1',
    status: 'COMPLETED',
    isHvb: false,
    tournamentMatchId: TM_SEED_P1,
    bestOfN: 3,
    seats: [
      { userId: 'ba_alice', status: 'occupied', displayName: 'Alice' },
      { userId: 'ba_bob',   status: 'occupied', displayName: 'Bob' },
    ],
    previewState: {
      board: Array(9).fill('X'),
      currentTurn: 'O',          // ended on O's turn (X won)
      scores: { X: 1, O: 0 },
      round: 1,
      winner: 'X',
      winLine: [0, 1, 2],
      marks: { ba_alice: 'X', ba_bob: 'O' },
      moves: [],
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.table.update.mockImplementation(({ data }) => Promise.resolve({ id: 'tbl_t1', ...data }))
})

describe('rematchGame — argument + state guards', () => {
  it('returns NOT_IN_TABLE when tableId is missing', async () => {
    const r = await rematchGame({ io: null, tableId: '' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('NOT_IN_TABLE')
  })

  it('returns TABLE_NOT_FOUND when the table does not exist', async () => {
    db.table.findUnique.mockResolvedValueOnce(null)
    const r = await rematchGame({ io: null, tableId: 't_missing' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('TABLE_NOT_FOUND')
  })

  it('returns NOT_COMPLETED when the table is mid-game', async () => {
    db.table.findUnique.mockResolvedValueOnce(existingTable({ status: 'ACTIVE' }))
    const r = await rematchGame({ io: null, tableId: 'tbl_t1' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('NOT_COMPLETED')
  })
})

describe('rematchGame — non-tournament (legacy behavior)', () => {
  it('flips currentTurn, keeps marks, bumps round', async () => {
    db.table.findUnique.mockResolvedValueOnce(existingTable({ tournamentMatchId: null }))
    const r = await rematchGame({ io: null, tableId: 'tbl_t1' })
    expect(r.ok).toBe(true)
    expect(r.previewState.currentTurn).toBe('X') // flipped from 'O'
    expect(r.previewState.round).toBe(2)
    expect(r.previewState.marks).toEqual({ ba_alice: 'X', ba_bob: 'O' }) // unchanged
    expect(r.previewState.tiebreaker).toBeUndefined()
  })
})

describe('rematchGame — tournament A2.5 branch', () => {
  it('game 2: swaps marks so the previous O-side becomes X, currentTurn=X', async () => {
    db.table.findUnique.mockResolvedValueOnce(existingTable())  // round 1 → 2
    const r = await rematchGame({ io: null, tableId: 'tbl_t1' })
    expect(r.ok).toBe(true)
    expect(r.previewState.round).toBe(2)
    // For seed 'tm_p1', sequence 2 swaps: player2 (ba_bob) gets X.
    expect(r.previewState.marks).toEqual({ ba_alice: 'O', ba_bob: 'X' })
    expect(r.previewState.currentTurn).toBe('X')
    expect(r.previewState.tiebreaker).toBeUndefined()
  })

  it('game 3 in a best-of-3 series: applies random tiebreaker + flags previewState', async () => {
    db.table.findUnique.mockResolvedValueOnce(existingTable({
      previewState: { ...existingTable().previewState, round: 2, scores: { X: 1, O: 1 } },
    }))
    const r = await rematchGame({ io: null, tableId: 'tbl_t1' })
    expect(r.ok).toBe(true)
    expect(r.previewState.round).toBe(3)
    expect(r.previewState.currentTurn).toBe('X')
    expect(r.previewState.tiebreaker).toBe(true)
    // The marks are deterministic from sha256('tm_p1:g3'); the assertion
    // we care about is that BOTH players have marks set + one is X.
    expect(Object.values(r.previewState.marks).sort()).toEqual(['O', 'X'])
  })

  it('game 3 with bestOfN < 3 does NOT use the tiebreaker (just continues the swap pattern)', async () => {
    db.table.findUnique.mockResolvedValueOnce(existingTable({
      bestOfN: 1,  // single-game series; this codepath shouldn't ever be hit in practice but we still must not flag it
      previewState: { ...existingTable().previewState, round: 2 },
    }))
    const r = await rematchGame({ io: null, tableId: 'tbl_t1' })
    expect(r.previewState.tiebreaker).toBeUndefined()
  })

  it('HvB tournament rematch: bot mark is recomputed from the new marks', async () => {
    db.table.findUnique.mockResolvedValueOnce(existingTable({
      isHvb: true,
      seats: [
        { userId: 'ba_alice', status: 'occupied', displayName: 'Alice' },
        { userId: 'bot_user_1', status: 'occupied', displayName: 'Rusty' },  // bot in seat[1]
      ],
      previewState: { ...existingTable().previewState, marks: { ba_alice: 'X', bot_user_1: 'O' }, botMark: 'O' },
    }))
    const r = await rematchGame({ io: null, tableId: 'tbl_t1' })
    // Game 2 swap → bot now plays X.
    expect(r.previewState.marks).toEqual({ ba_alice: 'O', bot_user_1: 'X' })
    expect(r.previewState.botMark).toBe('X')
  })

  it('skips the tournament branch when seats are malformed', async () => {
    db.table.findUnique.mockResolvedValueOnce(existingTable({
      seats: [{ userId: null }, { userId: 'ba_bob' }],
    }))
    const r = await rematchGame({ io: null, tableId: 'tbl_t1' })
    // Marks unchanged because the tournament block bailed.
    expect(r.previewState.marks).toEqual({ ba_alice: 'X', ba_bob: 'O' })
  })

  it('A2.7: emits match.game3.tiebreaker on game 3 of a BO3 tournament', async () => {
    db.table.findUnique.mockResolvedValueOnce(existingTable({
      previewState: { ...existingTable().previewState, round: 2, scores: { X: 1, O: 1 } },
    }))
    await rematchGame({ io: null, tableId: 'tbl_t1' })
    const tieCall = evt.appendToStream.mock.calls.find(c => c[1]?.kind === 'match.game3.tiebreaker')
    expect(tieCall).toBeDefined()
    expect(tieCall[1]).toMatchObject({
      kind:              'match.game3.tiebreaker',
      tournamentMatchId: 'tm_a',
      sequence:          3,
    })
  })

  it('does NOT emit match.game3.tiebreaker on a non-tiebreaker rematch (round 2)', async () => {
    db.table.findUnique.mockResolvedValueOnce(existingTable())
    await rematchGame({ io: null, tableId: 'tbl_t1' })
    const tieCall = evt.appendToStream.mock.calls.find(c => c[1]?.kind === 'match.game3.tiebreaker')
    expect(tieCall).toBeUndefined()
  })
})
