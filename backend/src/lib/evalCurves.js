// Copyright © 2026 Joe Pruskowski. All rights reserved.
//
// A3a.7 — multi-curve eval helpers.
//
// During training, the engine plays a small set of games against a fixed
// roster of "side curve" opponents and an algorithm-appropriate "primary"
// opponent. The W/D/L tallies become TrainingMetric rows; the frontend
// stacks them into per-curve area charts (saturated curves auto-fade).
//
// Budget: default ~20 games per eval (12 primary + 4 easy + 4 medium). At
// CHECKPOINT_GAP=200 episodes that's ~10% eval overhead in episode count,
// but each eval game is *no-learning* exploitation so the per-game cost is
// well under a training episode in practice — the realised wall-clock
// overhead lands closer to ~5%, matching the plan's target.
//
// All functions here are pure-ish: the runners take move functions and
// return tallies. Persistence is split out into `recordEvalMetrics` so
// the same eval batch can be reused under different storage layers later
// (e.g., the worker process in A3b).

import { getWinner, isBoardFull, getEmptyCells } from '@xo-arena/ai'

/**
 * Per-algorithm "primary" opponent. The full curve list is always
 * [primary, easy, medium] today; Master is reserved for Connect 4 (Phase B).
 *
 * 'minimax:<difficulty>' is the opponent identifier; the resolver in
 * `opponentMove` translates it to a move function.
 */
const PRIMARY_OPPONENT = Object.freeze({
  qlearning:      'minimax:hard',
  sarsa:          'minimax:hard',
  montecarlo:     'minimax:hard',
  policygradient: 'minimax:hard',
  dqn:            'minimax:hard',
  alphazero:      'minimax:hard',  // Master is C4-only; TTT keeps hard
  mcts:           'minimax:hard',
  rule_based:     'minimax:medium', // rule-based is weaker; calibrate accordingly
})

/** Default per-curve game count. ~20 games/eval total. */
export const DEFAULT_EVAL_BUDGET = Object.freeze({
  primary: 12,
  easy:    4,
  medium:  4,
})

/**
 * Return the opponent identifier (`'minimax:<difficulty>' | 'master'`) for
 * each curve label given the training algorithm. Unknown algorithms map to
 * the generic 'minimax:hard' primary.
 */
export function resolveCurves(algorithm) {
  const raw    = String(algorithm || '')
  const algKey = raw.toLowerCase().replace(/[-_]/g, '')
  // Try the normalised key first (handles Q_LEARNING → qlearning etc.)
  // then fall back to the literal value (matches the `rule_based` entry).
  const primary = PRIMARY_OPPONENT[algKey] ?? PRIMARY_OPPONENT[raw] ?? 'minimax:hard'
  return Object.freeze({
    primary,
    easy:    'minimax:easy',
    medium:  'minimax:medium',
  })
}

/**
 * Drive a single game between the training model and an opponent. Both
 * sides play to completion via their move functions. Returns the winner
 * mark, or null on draw.
 *
 *   modelMove(board)    — exploitation move from the model under training
 *   opponentMove(board) — opponent's move (e.g., minimax)
 *   modelMark           — 'X' or 'O'
 */
export function playEvalGame({ modelMove, opponentMove, modelMark }) {
  const board = Array(9).fill(null)
  const oppMark = modelMark === 'X' ? 'O' : 'X'
  let current = 'X'
  while (true) {
    if (getEmptyCells(board).length === 0) break
    const mover = current === modelMark ? modelMove : opponentMove
    const cell = mover(board, current)
    if (cell == null || cell < 0 || cell > 8 || board[cell] !== null) {
      // Illegal move = forfeit. Treat as a loss for the side that
      // produced it. This shouldn't happen in practice but the runner
      // must never throw — eval is best-effort.
      return current === modelMark ? oppMark : modelMark
    }
    board[cell] = current
    const winner = getWinner(board)
    if (winner) return winner
    if (isBoardFull(board)) return null
    current = current === 'X' ? 'O' : 'X'
  }
  return null
}

/**
 * Run N eval games between the model and a single opponent. Alternates
 * the model's mark every game so first-mover advantage washes out.
 *
 * Returns `{ wins, draws, losses, count }` from the model's POV.
 */
export function runEvalSeries({ modelMove, opponentMove, count }) {
  let wins = 0, draws = 0, losses = 0
  for (let i = 0; i < count; i++) {
    const modelMark = i % 2 === 0 ? 'X' : 'O'
    const winner = playEvalGame({ modelMove, opponentMove, modelMark })
    if (winner === modelMark) wins++
    else if (winner === null) draws++
    else losses++
  }
  return { wins, draws, losses, count }
}

/**
 * Run all three curves for one eval point. Returns an array of records
 * (one per opponent curve) ready to hand to `recordEvalMetrics`.
 *
 *   makeOpponentMove(opponentId) — factory: returns a move fn for the
 *                                  given curve opponent identifier.
 *
 * The factory is injected so callers can supply pre-built minimax move
 * functions (the production training loop already imports minimaxMove)
 * without this module having to know about every game's bot catalog.
 */
export function runEvalBatch({
  modelMove,
  makeOpponentMove,
  algorithm,
  episodeNum,
  budget = DEFAULT_EVAL_BUDGET,
}) {
  const curves = resolveCurves(algorithm)
  const records = []
  for (const label of ['primary', 'easy', 'medium']) {
    const count = budget[label] ?? 0
    if (count <= 0) continue
    const opponentMove = makeOpponentMove(curves[label])
    const { wins, draws, losses } = runEvalSeries({ modelMove, opponentMove, count })
    records.push({
      episodeNum,
      opponentLabel: label,
      wins, draws, losses,
    })
  }
  return records
}

/**
 * Persist a runEvalBatch result to TrainingMetric. Wrapped in
 * fire-and-forget at the call site — eval should never block the
 * training loop. Returns the createMany result for tests.
 */
export async function recordEvalMetrics(db, sessionId, records) {
  if (!records?.length) return { count: 0 }
  return db.trainingMetric.createMany({
    data: records.map(r => ({
      sessionId,
      episodeNum:    r.episodeNum,
      opponentLabel: r.opponentLabel,
      wins:          r.wins,
      draws:         r.draws,
      losses:        r.losses,
    })),
  })
}
