import { describe, it, expect } from 'vitest'
import { minimaxMove, getWinner, getEmptyCells } from '@xo-arena/ai'

// --- Correctness fixtures (Master must always return the known optimal move) ---

describe('Master — correctness fixtures', () => {
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
    // Empty board: all 9 cells score equally under negamax (TTT is a
    // forced draw under optimal play). Master picks among center +
    // corners with random tiebreak, never edges. Asserted via the
    // "tied-best randomization" describe block below; this fixture
    // entry is intentionally omitted so the table-driven test doesn't
    // hard-code one of five valid answers.
    {
      // O has opposite corners (0, 8); both diagonals need center (4) to complete.
      // X must take center to block or face an immediate diagonal win next turn.
      name: 'blocks diagonal threat',
      board: ['O', null, null, null, null, null, null, null, 'O'],
      player: 'X',
      expected: 4,
    },
  ]

  for (const { name, board, player, expected } of cases) {
    it(name, () => {
      expect(minimaxMove(board, 'master', player)).toBe(expected)
    })
  }
})

describe('Master — never loses', () => {
  /**
   * Simulate a full game between two Master AIs — result must always be draw
   * (or AI wins, which is fine; it must never lose).
   */
  function playGame(startingPlayer) {
    const board = Array(9).fill(null)
    let current = startingPlayer

    for (let turn = 0; turn < 9; turn++) {
      if (getEmptyCells(board).length === 0) break
      const move = minimaxMove(board, 'master', current)
      board[move] = current
      const winner = getWinner(board)
      if (winner) return winner
      current = current === 'X' ? 'O' : 'X'
    }
    return null // draw
  }

  it('Master vs Master always draws (X starts)', () => {
    const result = playGame('X')
    expect(result).toBeNull()
  })

  it('Master vs Master always draws (O starts)', () => {
    const result = playGame('O')
    expect(result).toBeNull()
  })
})

// --- Master — tied-best randomization (regression for prod 2026-05-09) ---
//
// Pre-fix `masterMove` iterated empty cells in fixed order and kept the
// first move with the best score. From an empty board, all four corners
// and the center tie at score 0 (draw vs optimal play), but cell-0 always
// won the tie. Bot-vs-bot tournaments therefore replayed the same opening
// every game. Shuffling the empty-cell order preserves optimality (we
// only ever pick from moves the engine considers equally best) and
// restores variety.

describe('Master — tied-best randomization', () => {
  it('opens an empty board across center + all four corners (>5% each, never an edge)', () => {
    const counts = new Map()
    const N = 500
    for (let i = 0; i < N; i++) {
      const board = Array(9).fill(null)
      const move = minimaxMove(board, 'master', 'X')
      counts.set(move, (counts.get(move) ?? 0) + 1)
    }

    // Each of the 5 optimal openings should appear with frequency > 5%.
    // (Uniform expectation is 20%; >5% catches "always picks one corner".)
    for (const cell of [0, 2, 4, 6, 8]) {
      const pct = (counts.get(cell) ?? 0) / N
      expect(pct, `cell ${cell} appeared ${pct * 100}% of ${N} runs`).toBeGreaterThan(0.05)
    }
    // Edge openings (1, 3, 5, 7) lose against optimal play and must NEVER
    // appear from masterMove on an empty board.
    for (const cell of [1, 3, 5, 7]) {
      expect(counts.get(cell) ?? 0, `edge cell ${cell} should never be played`).toBe(0)
    }
  })

  it('still always plays the unique best move when there is no tie', () => {
    // Position with an immediate win at cell 2 — there's no tie, master
    // must always pick it regardless of shuffle order.
    const board = ['X', 'X', null, 'O', 'O', null, null, null, null]
    for (let i = 0; i < 100; i++) {
      const move = minimaxMove(board, 'master', 'X')
      expect(move).toBe(2)
    }
  })

  it('still never loses across many randomized master-vs-master games', () => {
    // Same coverage as "Master vs Master always draws" but repeated with
    // shuffle-driven variety. Every game must still draw (or master wins);
    // randomization must never produce a losing move.
    function playGame(starter) {
      const board = Array(9).fill(null)
      let current = starter
      for (let turn = 0; turn < 9; turn++) {
        if (getEmptyCells(board).length === 0) break
        const move = minimaxMove(board, 'master', current)
        board[move] = current
        const winner = getWinner(board)
        if (winner) return winner
        current = current === 'X' ? 'O' : 'X'
      }
      return null  // draw
    }
    for (let i = 0; i < 50; i++) {
      const r = playGame(i % 2 === 0 ? 'X' : 'O')
      expect(r, 'master must never lose to itself').toBeNull()
    }
  })

  it('produces visibly different opening sequences across master-vs-master games', () => {
    // Sanity check: across N games, the first three moves shouldn't all
    // be identical (which is exactly what the pre-fix bot did).
    const sequences = new Set()
    for (let i = 0; i < 30; i++) {
      const board = Array(9).fill(null)
      let current = 'X'
      const seq = []
      for (let turn = 0; turn < 3; turn++) {
        const move = minimaxMove(board, 'master', current)
        board[move] = current
        seq.push(move)
        current = current === 'X' ? 'O' : 'X'
      }
      sequences.add(seq.join(','))
    }
    expect(sequences.size, 'expected >1 distinct opening across 30 games').toBeGreaterThan(1)
  })
})

// --- Difficulty behavioural tests ---

describe('Novice — plays randomly (valid moves only)', () => {
  it('always returns a valid empty cell', () => {
    const board = ['X', 'O', null, 'O', 'X', null, null, null, null]
    for (let i = 0; i < 50; i++) {
      const move = minimaxMove(board, 'novice', 'X')
      expect(board[move]).toBeNull()
    }
  })
})

describe('Intermediate — wins when available', () => {
  it('takes the winning move', () => {
    const board = ['X', 'X', null, 'O', 'O', null, null, null, null]
    const move = minimaxMove(board, 'intermediate', 'X')
    expect(move).toBe(2)
  })

  it('blocks opponent when opponent would win next move', () => {
    const board = ['O', 'O', null, 'X', null, null, null, null, null]
    const move = minimaxMove(board, 'intermediate', 'X')
    expect(move).toBe(2)
  })
})

// --- Performance regression test ---

describe('Master — performance', () => {
  it('responds in ≤500ms on worst-case (empty board)', () => {
    const board = Array(9).fill(null)
    const start = Date.now()
    minimaxMove(board, 'master', 'X')
    expect(Date.now() - start).toBeLessThan(500)
  })
})
