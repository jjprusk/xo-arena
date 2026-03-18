import { describe, it, expect } from 'vitest'
import { minimaxMove } from '../minimax.js'
import { getWinner, getEmptyCells } from '../gameLogic.js'

// --- Correctness fixtures (Hard must always return the known optimal move) ---

describe('Hard — correctness fixtures', () => {
  const cases = [
    {
      name: 'takes winning move (row)',
      board: ['X', 'X', null, 'O', 'O', null, null, null, null],
      player: 'X',
      expected: 2,
    },
    {
      name: 'takes winning move (column)',
      board: ['O', null, null, 'O', null, null, null, null, null],
      player: 'O',
      expected: 6,
    },
    {
      name: 'blocks opponent win (row)',
      board: ['O', 'O', null, 'X', null, null, null, null, null],
      player: 'X',
      expected: 2,
    },
    // Empty board: all positions are equal by minimax; algorithm takes first best (index 0)
    {
      name: 'returns a valid move on empty board',
      board: Array(9).fill(null),
      player: 'X',
      expected: 0,
    },
    {
      name: 'blocks diagonal threat',
      board: ['O', null, null, null, 'O', null, null, null, null],
      player: 'X',
      expected: 8,
    },
  ]

  for (const { name, board, player, expected } of cases) {
    it(name, () => {
      expect(minimaxMove(board, 'hard', player)).toBe(expected)
    })
  }
})

describe('Hard — never loses', () => {
  /**
   * Simulate a full game between two Hard AIs — result must always be draw
   * (or AI wins, which is fine; it must never lose).
   */
  function playGame(startingPlayer) {
    const board = Array(9).fill(null)
    let current = startingPlayer

    for (let turn = 0; turn < 9; turn++) {
      if (getEmptyCells(board).length === 0) break
      const move = minimaxMove(board, 'hard', current)
      board[move] = current
      const winner = getWinner(board)
      if (winner) return winner
      current = current === 'X' ? 'O' : 'X'
    }
    return null // draw
  }

  it('Hard vs Hard always draws (X starts)', () => {
    const result = playGame('X')
    expect(result).toBeNull()
  })

  it('Hard vs Hard always draws (O starts)', () => {
    const result = playGame('O')
    expect(result).toBeNull()
  })
})

// --- Difficulty behavioural tests ---

describe('Easy — plays randomly (valid moves only)', () => {
  it('always returns a valid empty cell', () => {
    const board = ['X', 'O', null, 'O', 'X', null, null, null, null]
    for (let i = 0; i < 50; i++) {
      const move = minimaxMove(board, 'easy', 'X')
      expect(board[move]).toBeNull()
    }
  })
})

describe('Medium — wins when available', () => {
  it('takes the winning move', () => {
    const board = ['X', 'X', null, 'O', 'O', null, null, null, null]
    const move = minimaxMove(board, 'medium', 'X')
    expect(move).toBe(2)
  })

  it('blocks opponent when opponent would win next move', () => {
    const board = ['O', 'O', null, 'X', null, null, null, null, null]
    const move = minimaxMove(board, 'medium', 'X')
    expect(move).toBe(2)
  })
})

// --- Performance regression test ---

describe('Hard — performance', () => {
  it('responds in ≤500ms on worst-case (empty board)', () => {
    const board = Array(9).fill(null)
    const start = Date.now()
    minimaxMove(board, 'hard', 'X')
    expect(Date.now() - start).toBeLessThan(500)
  })
})
