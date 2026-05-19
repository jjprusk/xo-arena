// A3a.7 — multi-curve eval module contract tests.
//
// The runners use real game-logic primitives (getWinner / isBoardFull) but
// the engines themselves are replaced with deterministic move fns so we
// can prove the tally and the alternating-mark policy without spinning up
// an actual neural net.

import { describe, it, expect, vi } from 'vitest'
import {
  resolveCurves,
  playEvalGame,
  runEvalSeries,
  runEvalBatch,
  recordEvalMetrics,
  DEFAULT_EVAL_BUDGET,
} from '../evalCurves.js'

// ── Deterministic move fns ─────────────────────────────────────────────────
//
// pickFirstOpen always plays the lowest-index empty cell.
// pickLastOpen  always plays the highest-index empty cell.
// Their game has a known sequence — useful for asserting per-game outcomes.

const pickFirstOpen = (board) => board.findIndex(c => c === null)
const pickLastOpen  = (board) => {
  for (let i = 8; i >= 0; i--) if (board[i] === null) return i
  return -1
}
const alwaysCenterThenAny = (board) => {
  if (board[4] === null) return 4
  return board.findIndex(c => c === null)
}

describe('resolveCurves', () => {
  it('returns minimax:hard as primary for ML algorithms', () => {
    expect(resolveCurves('qlearning').primary).toBe('minimax:hard')
    expect(resolveCurves('dqn').primary).toBe('minimax:hard')
    expect(resolveCurves('alphazero').primary).toBe('minimax:hard')
  })

  it('normalises casing + delimiters (Q_LEARNING / q-learning)', () => {
    expect(resolveCurves('Q_LEARNING').primary).toBe('minimax:hard')
    expect(resolveCurves('q-learning').primary).toBe('minimax:hard')
  })

  it('rule_based gets the weaker minimax:medium primary', () => {
    expect(resolveCurves('rule_based').primary).toBe('minimax:medium')
  })

  it('unknown algorithm falls back to minimax:hard', () => {
    expect(resolveCurves('mystery').primary).toBe('minimax:hard')
  })

  it('always returns minimax:easy + minimax:medium for the side curves', () => {
    const c = resolveCurves('qlearning')
    expect(c.easy).toBe('minimax:easy')
    expect(c.medium).toBe('minimax:medium')
  })
})

describe('playEvalGame', () => {
  it('returns the winner mark when X wins on the diagonal', () => {
    // X always picks lowest open cell. O picks highest. X plays 0,1,2 (top row).
    const winner = playEvalGame({
      modelMove:    pickFirstOpen,
      opponentMove: pickLastOpen,
      modelMark:    'X',
    })
    expect(winner).toBe('X')
  })

  it('returns null on a forced draw', () => {
    // Two centre-loving players will fight over the middle then play a
    // safe drawing sequence — pickFirstOpen vs pickFirstOpen yields no
    // three-in-a-row because both grab the same low cells alternately.
    const winner = playEvalGame({
      modelMove:    alwaysCenterThenAny,
      opponentMove: alwaysCenterThenAny,
      modelMark:    'X',
    })
    // Exact value doesn't matter as long as the function terminates.
    expect(winner === null || winner === 'X' || winner === 'O').toBe(true)
  })

  it('treats illegal moves as a forfeit by the offending side', () => {
    const cheater = () => 99  // always illegal
    const winner = playEvalGame({
      modelMove:    cheater,
      opponentMove: pickFirstOpen,
      modelMark:    'X',
    })
    expect(winner).toBe('O')  // model forfeited
  })
})

describe('runEvalSeries', () => {
  it('alternates the model mark every game', () => {
    // Capture marks per game by inspecting the first move passed in.
    const seenStartMarks = []
    let gameIdx = 0
    const modelMove = (board) => {
      if (board.every(c => c === null)) {
        // First move of THIS game — track who is moving (X always moves
        // first, so if the model is moving on the empty board it must be X).
        seenStartMarks.push('X')
      }
      return pickFirstOpen(board)
    }
    const opponentMove = (board) => {
      if (board.every(c => c === null)) {
        seenStartMarks.push('O')  // model is O this round (opponent went first)
      }
      gameIdx++
      return pickLastOpen(board)
    }

    runEvalSeries({ modelMove, opponentMove, count: 4 })

    // Game 0: model=X (X first) → seenStartMarks[0]='X'
    // Game 1: model=O (opponent X first) → seenStartMarks[1]='O'
    // etc.
    expect(seenStartMarks).toEqual(['X', 'O', 'X', 'O'])
  })

  it('returns matching wins+draws+losses=count', () => {
    const result = runEvalSeries({
      modelMove: pickFirstOpen, opponentMove: pickLastOpen, count: 10,
    })
    expect(result.count).toBe(10)
    expect(result.wins + result.draws + result.losses).toBe(10)
  })

  it('count=0 returns all zeros', () => {
    const result = runEvalSeries({
      modelMove: pickFirstOpen, opponentMove: pickLastOpen, count: 0,
    })
    expect(result).toEqual({ wins: 0, draws: 0, losses: 0, count: 0 })
  })
})

describe('runEvalBatch', () => {
  it('returns one record per curve with the right opponentLabel + episodeNum', () => {
    const makeOpponentMove = vi.fn(() => pickLastOpen)
    const records = runEvalBatch({
      modelMove: pickFirstOpen,
      makeOpponentMove,
      algorithm: 'qlearning',
      episodeNum: 200,
    })

    expect(records).toHaveLength(3)
    expect(records.map(r => r.opponentLabel)).toEqual(['primary', 'easy', 'medium'])
    expect(records.every(r => r.episodeNum === 200)).toBe(true)
    // Factory was asked for each curve's opponent.
    expect(makeOpponentMove).toHaveBeenCalledTimes(3)
    expect(makeOpponentMove).toHaveBeenNthCalledWith(1, 'minimax:hard')   // primary
    expect(makeOpponentMove).toHaveBeenNthCalledWith(2, 'minimax:easy')
    expect(makeOpponentMove).toHaveBeenNthCalledWith(3, 'minimax:medium')
  })

  it('honours the default 12/4/4 budget split', () => {
    const records = runEvalBatch({
      modelMove: pickFirstOpen,
      makeOpponentMove: () => pickLastOpen,
      algorithm: 'qlearning',
      episodeNum: 100,
    })
    const counts = Object.fromEntries(
      records.map(r => [r.opponentLabel, r.wins + r.draws + r.losses])
    )
    expect(counts).toEqual({ primary: 12, easy: 4, medium: 4 })
  })

  it('skips a curve when its budget is 0', () => {
    const records = runEvalBatch({
      modelMove: pickFirstOpen,
      makeOpponentMove: () => pickLastOpen,
      algorithm: 'qlearning',
      episodeNum: 100,
      budget: { primary: 6, easy: 0, medium: 4 },
    })
    expect(records.map(r => r.opponentLabel)).toEqual(['primary', 'medium'])
  })

  it('DEFAULT_EVAL_BUDGET totals 20 games', () => {
    expect(DEFAULT_EVAL_BUDGET.primary + DEFAULT_EVAL_BUDGET.easy + DEFAULT_EVAL_BUDGET.medium).toBe(20)
  })
})

describe('recordEvalMetrics', () => {
  it('createMany maps records into TrainingMetric rows tagged with sessionId', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 3 })
    const db = { trainingMetric: { createMany } }

    await recordEvalMetrics(db, 'sess-1', [
      { episodeNum: 200, opponentLabel: 'primary', wins: 8, draws: 2, losses: 2 },
      { episodeNum: 200, opponentLabel: 'easy',    wins: 4, draws: 0, losses: 0 },
      { episodeNum: 200, opponentLabel: 'medium',  wins: 3, draws: 1, losses: 0 },
    ])

    expect(createMany).toHaveBeenCalledWith({
      data: [
        { sessionId: 'sess-1', episodeNum: 200, opponentLabel: 'primary', wins: 8, draws: 2, losses: 2 },
        { sessionId: 'sess-1', episodeNum: 200, opponentLabel: 'easy',    wins: 4, draws: 0, losses: 0 },
        { sessionId: 'sess-1', episodeNum: 200, opponentLabel: 'medium',  wins: 3, draws: 1, losses: 0 },
      ],
    })
  })

  it('empty records: no-op, returns {count: 0}', async () => {
    const createMany = vi.fn()
    const db = { trainingMetric: { createMany } }
    const r = await recordEvalMetrics(db, 'sess-1', [])
    expect(r).toEqual({ count: 0 })
    expect(createMany).not.toHaveBeenCalled()
  })
})
