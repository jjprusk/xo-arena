// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect } from 'vitest'
import { CELLS, MARKS, emptyBoard, drop, indexOf } from '../logic.js'
import {
  serializeBoard, deserializeBoard,
  serializeState,  deserializeState,
} from '../serializer.js'

const Y = MARKS.FIRST
const R = MARKS.SECOND

describe('serializer — board encoding', () => {
  it('serializes an empty board to 42 dots', () => {
    const s = serializeBoard(emptyBoard())
    expect(s.length).toBe(CELLS)
    expect(s).toBe('.'.repeat(CELLS))
  })

  it('serializes marks in the right positions', () => {
    let b = emptyBoard()
    b = drop(b, 0, Y).board  // → indexOf(5, 0) = 35
    b = drop(b, 6, R).board  // → indexOf(5, 6) = 41
    const s = serializeBoard(b)
    expect(s[35]).toBe('Y')
    expect(s[41]).toBe('R')
    // Everything else still empty.
    for (let i = 0; i < CELLS; i++) {
      if (i !== 35 && i !== 41) expect(s[i]).toBe('.')
    }
  })

  it('round-trips empty board', () => {
    const original = emptyBoard()
    const restored = deserializeBoard(serializeBoard(original))
    expect(restored).toEqual(original)
  })

  it('round-trips a mid-game position', () => {
    let b = emptyBoard()
    const moves = [
      [3, Y], [3, R], [4, Y], [2, R], [5, Y], [4, R],
      [2, Y], [3, Y], [4, Y], [0, R], [1, R], [6, Y],
    ]
    for (const [col, mark] of moves) b = drop(b, col, mark).board
    const restored = deserializeBoard(serializeBoard(b))
    expect(restored).toEqual(b)
  })

  it('throws on wrong-length input', () => {
    expect(() => serializeBoard([])).toThrow()
    expect(() => serializeBoard(Array(41).fill(null))).toThrow()
    expect(() => deserializeBoard('')).toThrow()
    expect(() => deserializeBoard('.'.repeat(41))).toThrow()
    expect(() => deserializeBoard('.'.repeat(43))).toThrow()
  })

  it('rejects unknown chars on decode', () => {
    const bad = 'X'.repeat(CELLS)
    expect(() => deserializeBoard(bad)).toThrow(/invalid char/)
    const mixedBad = '.'.repeat(CELLS - 1) + 'Z'
    expect(() => deserializeBoard(mixedBad)).toThrow(/invalid char/)
  })

  it('rejects non-string input on decode', () => {
    expect(() => deserializeBoard(null)).toThrow()
    expect(() => deserializeBoard(undefined)).toThrow()
    expect(() => deserializeBoard(42)).toThrow()
  })
})

describe('serializer — state encoding (board + turn)', () => {
  it('appends turn after a pipe separator', () => {
    const state = { board: emptyBoard(), turn: Y }
    const s = serializeState(state)
    expect(s.length).toBe(CELLS + 2) // 42 + '|' + 'Y'
    expect(s.endsWith('|Y')).toBe(true)
  })

  it('round-trips state for both turns', () => {
    for (const turn of [Y, R]) {
      let board = emptyBoard()
      board = drop(board, 3, Y).board
      board = drop(board, 3, R).board
      const original = { board, turn }
      const restored = deserializeState(serializeState(original))
      expect(restored.board).toEqual(original.board)
      expect(restored.turn).toBe(turn)
    }
  })

  it('throws on invalid turn during encode', () => {
    const b = emptyBoard()
    expect(() => serializeState({ board: b, turn: 'X' })).toThrow()
    expect(() => serializeState({ board: b, turn: null })).toThrow()
  })

  it('throws on missing pipe during decode', () => {
    expect(() => deserializeState('.'.repeat(CELLS))).toThrow(/missing/)
  })

  it('throws on invalid turn during decode', () => {
    expect(() => deserializeState('.'.repeat(CELLS) + '|Z')).toThrow(/invalid turn/)
  })

  it('throws on non-string input during decode', () => {
    expect(() => deserializeState(null)).toThrow()
    expect(() => deserializeState(123)).toThrow()
  })
})

describe('serializer — bot-friendly key stability', () => {
  // Tabular learners (Q-learning, SARSA, MC) hash the state string as the
  // Q-table key. The serializer must produce a stable, canonical string —
  // two boards that are structurally identical must produce identical keys
  // regardless of how they were constructed.
  it('two paths to the same position serialize identically', () => {
    // Path A: drop in column 0, then column 1.
    let a = emptyBoard()
    a = drop(a, 0, Y).board
    a = drop(a, 1, R).board
    // Path B: drop in column 1, then column 0 — same final position with
    // different reasoning paths, but board contents at indices 35/36 are
    // distinct so the boards differ. Use this case only as a counter-check.
    let b = emptyBoard()
    b = drop(b, 1, Y).board
    b = drop(b, 0, R).board
    // Y is in column 0 on board A, column 1 on board B — they should NOT
    // serialize identically.
    expect(serializeBoard(a)).not.toBe(serializeBoard(b))

    // Now construct the same final position via two move orderings. Symmetric
    // example: Y to (5,3), R to (5,4) — order shouldn't matter for the final
    // board state.
    let c = emptyBoard()
    c = drop(c, 3, Y).board
    c = drop(c, 4, R).board
    let d = emptyBoard()
    d[indexOf(5, 3)] = Y
    d[indexOf(5, 4)] = R
    expect(serializeBoard(c)).toBe(serializeBoard(d))
  })
})
