/**
 * Tests for puzzleGenerator.js.
 *
 * These are property-based checks — we run each generator several times
 * and assert structural invariants that must hold for every output.
 * No mocks needed: the generators and @xo-arena/ai helpers are pure functions.
 */

import { describe, it, expect } from 'vitest'
import {
  generateWin1Puzzle,
  generateBlock1Puzzle,
  generateForkPuzzle,
  generateSurvivePuzzle,
  PUZZLE_TYPES,
  PUZZLE_META,
} from '../puzzleGenerator.js'
import { getWinner, getEmptyCells } from '@xo-arena/ai'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Run a generator up to `runs` times, return an array of non-null results. */
function collect(gen, runs = 5) {
  const results = []
  for (let i = 0; i < runs; i++) {
    const p = gen()
    if (p) results.push(p)
  }
  return results
}

/** Assert common structural invariants that every puzzle must satisfy. */
function assertPuzzleShape(puzzle, expectedType) {
  expect(puzzle).not.toBeNull()

  // Board shape
  expect(Array.isArray(puzzle.board)).toBe(true)
  expect(puzzle.board).toHaveLength(9)
  expect(puzzle.board.every(c => c === null || c === 'X' || c === 'O')).toBe(true)

  // No winner before the puzzle move
  expect(getWinner(puzzle.board)).toBeNull()

  // Type + metadata
  expect(puzzle.type).toBe(expectedType)
  expect(typeof puzzle.title).toBe('string')
  expect(puzzle.title.length).toBeGreaterThan(0)
  expect(typeof puzzle.description).toBe('string')

  // toPlay must be X or O
  expect(['X', 'O']).toContain(puzzle.toPlay)

  // Solutions: non-empty array of valid cell indices on empty cells
  expect(Array.isArray(puzzle.solutions)).toBe(true)
  expect(puzzle.solutions.length).toBeGreaterThan(0)
  const empty = getEmptyCells(puzzle.board)
  for (const s of puzzle.solutions) {
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThanOrEqual(8)
    expect(empty).toContain(s)
  }
}

// ─── generateWin1Puzzle ───────────────────────────────────────────────────────

describe('generateWin1Puzzle', () => {
  it('returns a puzzle eventually', () => {
    const puzzle = generateWin1Puzzle()
    expect(puzzle).not.toBeNull()
  })

  it('satisfies structural invariants', () => {
    const puzzles = collect(generateWin1Puzzle, 8)
    expect(puzzles.length).toBeGreaterThan(0)
    for (const p of puzzles) assertPuzzleShape(p, 'win1')
  })

  it('solution cell wins immediately for toPlay', () => {
    const puzzles = collect(generateWin1Puzzle, 8)
    for (const p of puzzles) {
      // Exactly one solution (filtered in generator)
      expect(p.solutions).toHaveLength(1)
      const b = [...p.board]
      b[p.solutions[0]] = p.toPlay
      expect(getWinner(b)).toBe(p.toPlay)
    }
  })

  it('has exactly one winning move', () => {
    const puzzles = collect(generateWin1Puzzle, 8)
    for (const p of puzzles) {
      const empty = getEmptyCells(p.board)
      const wins = empty.filter(i => {
        const b = [...p.board]; b[i] = p.toPlay; return getWinner(b) === p.toPlay
      })
      expect(wins).toHaveLength(1)
    }
  })
})

// ─── generateBlock1Puzzle ─────────────────────────────────────────────────────

describe('generateBlock1Puzzle', () => {
  it('returns a puzzle eventually', () => {
    const puzzle = generateBlock1Puzzle()
    expect(puzzle).not.toBeNull()
  })

  it('satisfies structural invariants', () => {
    const puzzles = collect(generateBlock1Puzzle, 8)
    expect(puzzles.length).toBeGreaterThan(0)
    for (const p of puzzles) assertPuzzleShape(p, 'block1')
  })

  it('toPlay has no immediate winning move', () => {
    const puzzles = collect(generateBlock1Puzzle, 8)
    for (const p of puzzles) {
      const empty = getEmptyCells(p.board)
      const wins = empty.filter(i => {
        const b = [...p.board]; b[i] = p.toPlay; return getWinner(b) === p.toPlay
      })
      expect(wins).toHaveLength(0)
    }
  })

  it('each solution blocks an opponent win', () => {
    const puzzles = collect(generateBlock1Puzzle, 8)
    const opp = (m) => m === 'X' ? 'O' : 'X'
    for (const p of puzzles) {
      for (const sol of p.solutions) {
        // Opponent can win at this cell
        const b = [...p.board]; b[sol] = opp(p.toPlay)
        expect(getWinner(b)).toBe(opp(p.toPlay))
      }
    }
  })
})

// ─── generateForkPuzzle ───────────────────────────────────────────────────────

describe('generateForkPuzzle', () => {
  it('returns a puzzle eventually', () => {
    const puzzle = generateForkPuzzle()
    expect(puzzle).not.toBeNull()
  })

  it('satisfies structural invariants', () => {
    const puzzles = collect(generateForkPuzzle, 8)
    expect(puzzles.length).toBeGreaterThan(0)
    for (const p of puzzles) assertPuzzleShape(p, 'fork')
  })

  it('toPlay has no immediate win before the fork move', () => {
    const puzzles = collect(generateForkPuzzle, 8)
    for (const p of puzzles) {
      const empty = getEmptyCells(p.board)
      const wins = empty.filter(i => {
        const b = [...p.board]; b[i] = p.toPlay; return getWinner(b) === p.toPlay
      })
      expect(wins).toHaveLength(0)
    }
  })

  it('playing a solution creates at least two winning threats', () => {
    const puzzles = collect(generateForkPuzzle, 8)
    for (const p of puzzles) {
      for (const sol of p.solutions) {
        const b = [...p.board]; b[sol] = p.toPlay
        const nextEmpty = getEmptyCells(b)
        const threats = nextEmpty.filter(i => {
          const b2 = [...b]; b2[i] = p.toPlay; return getWinner(b2) === p.toPlay
        })
        expect(threats.length).toBeGreaterThanOrEqual(2)
      }
    }
  })
})

// ─── generateSurvivePuzzle ────────────────────────────────────────────────────

describe('generateSurvivePuzzle', () => {
  it('returns a puzzle eventually', () => {
    const puzzle = generateSurvivePuzzle()
    expect(puzzle).not.toBeNull()
  })

  it('satisfies structural invariants', () => {
    const puzzles = collect(generateSurvivePuzzle, 8)
    expect(puzzles.length).toBeGreaterThan(0)
    for (const p of puzzles) assertPuzzleShape(p, 'survive')
  })

  it('has at most 2 solutions (as filtered by generator)', () => {
    const puzzles = collect(generateSurvivePuzzle, 8)
    for (const p of puzzles) {
      expect(p.solutions.length).toBeGreaterThanOrEqual(1)
      expect(p.solutions.length).toBeLessThanOrEqual(2)
    }
  })

  it('opponent has at least one winning threat (makes puzzle feel urgent)', () => {
    const puzzles = collect(generateSurvivePuzzle, 8)
    const opp = (m) => m === 'X' ? 'O' : 'X'
    for (const p of puzzles) {
      const empty = getEmptyCells(p.board)
      const oppWins = empty.filter(i => {
        const b = [...p.board]; b[i] = opp(p.toPlay); return getWinner(b) === opp(p.toPlay)
      })
      expect(oppWins.length).toBeGreaterThan(0)
    }
  })

  it('toPlay has no immediate win', () => {
    const puzzles = collect(generateSurvivePuzzle, 8)
    for (const p of puzzles) {
      const empty = getEmptyCells(p.board)
      const wins = empty.filter(i => {
        const b = [...p.board]; b[i] = p.toPlay; return getWinner(b) === p.toPlay
      })
      expect(wins).toHaveLength(0)
    }
  })
})

// ─── PUZZLE_TYPES registry ────────────────────────────────────────────────────

describe('PUZZLE_TYPES', () => {
  it('has entries for all four types', () => {
    expect(Object.keys(PUZZLE_TYPES).sort()).toEqual(['block1', 'fork', 'survive', 'win1'])
  })

  it('each entry is a callable that returns a puzzle', () => {
    for (const [type, gen] of Object.entries(PUZZLE_TYPES)) {
      const puzzle = gen()
      if (puzzle) {
        expect(puzzle.type).toBe(type)
      }
    }
  })
})

// ─── PUZZLE_META registry ─────────────────────────────────────────────────────

describe('PUZZLE_META', () => {
  it('has metadata for all four types', () => {
    expect(Object.keys(PUZZLE_META).sort()).toEqual(['block1', 'fork', 'survive', 'win1'])
  })

  it('each entry has label and color', () => {
    for (const meta of Object.values(PUZZLE_META)) {
      expect(typeof meta.label).toBe('string')
      expect(meta.label.length).toBeGreaterThan(0)
      expect(typeof meta.color).toBe('string')
    }
  })
})

// ─── Puzzles route integration (count + type round-robin) ────────────────────

describe('puzzle count and type distribution', () => {
  it('generates up to 8 puzzles of mixed types without errors', () => {
    const types = Object.keys(PUZZLE_TYPES)
    const puzzles = []
    let attempts = 0
    while (puzzles.length < 8 && attempts < 80) {
      attempts++
      const t = types[puzzles.length % types.length]
      const p = PUZZLE_TYPES[t]()
      if (p) puzzles.push({ id: `${t}_${puzzles.length}`, ...p })
    }
    expect(puzzles.length).toBeGreaterThan(0)
    for (const p of puzzles) {
      expect(['win1', 'block1', 'fork', 'survive']).toContain(p.type)
    }
  })

  it('maybeFlip preserves solution validity (toPlay always matches solutions)', () => {
    // Run many puzzles — some will have been flipped by maybeFlip
    const puzzles = []
    for (let i = 0; i < 20; i++) {
      const p = generateWin1Puzzle()
      if (p) puzzles.push(p)
    }
    for (const p of puzzles) {
      const b = [...p.board]
      b[p.solutions[0]] = p.toPlay
      expect(getWinner(b)).toBe(p.toPlay)
    }
  })
})
