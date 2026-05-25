// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Connect Four minimax — alpha-beta search with center-first move ordering
 * and a line-scoring positional evaluator.
 *
 * Used by:
 *   - `botInterface.makeMove` for built-in minimax personas (B1.5)
 *   - `master.js` for full-depth perfect play (B1.6 — same engine, deeper
 *     search + stronger heuristics)
 *
 * Design choices and the "why":
 *
 * 1. **Center-first ordering.** Connect Four's center column is the most
 *    valuable square — it participates in more winning lines than any
 *    other column (7 lines through the center vs. 3 through the corners).
 *    Searching center moves first dramatically improves alpha-beta cutoff
 *    rates and is the single biggest perf win at low/medium depths.
 *
 * 2. **Line-based evaluation.** For non-terminal nodes we iterate the 69
 *    WIN_LINES and score each one based on what the two players have in
 *    it. The scoring weights make threats progressively scarier:
 *      - 4 in a row → effectively infinite (terminal)
 *      - 3 + 1 empty → +100 (one move from a win)
 *      - 2 + 2 empty → +10
 *      - 1 + 3 empty → +1
 *      - any line containing both colors → 0 (dead)
 *    Net score = my lines − their lines. This is cheap (O(69)), correct
 *    in sign at every node, and good enough at depths 2-6 that the bots
 *    feel like the difficulty labels imply.
 *
 * 3. **Iterative play, not iterative deepening.** B1 keeps the search
 *    simple — one fixed-depth pass per move. Iterative deepening + a
 *    transposition table would be the next step if Hard/Master need
 *    sub-second responses at higher depths (B1.6 or a follow-up).
 */

import {
  COLS, opponent,
  drop, getWinner, getLegalMoves, isBoardFull,
  WIN_LINES,
} from './logic.js'

/** Score reserved for a guaranteed win/loss — large enough to dominate
 *  any positional sum and survive the `−depth` faster-win bias. */
export const WIN_SCORE = 1_000_000

/** Column-traversal order biased toward the center: [3, 2, 4, 1, 5, 0, 6].
 *  Computed once at module load. */
export const CENTER_ORDER = (() => {
  const mid = Math.floor(COLS / 2) // 3 for 7 cols
  const order = [mid]
  for (let d = 1; d <= mid; d++) {
    if (mid - d >= 0)   order.push(mid - d)
    if (mid + d < COLS) order.push(mid + d)
  }
  return order
})()

/**
 * Static evaluator. Returns score from `mark`'s perspective:
 *   positive → mark is winning, negative → losing, 0 → balanced.
 *
 * Only called on non-terminal positions (terminal positions return
 * ±WIN_SCORE directly from the search).
 */
export function evaluate(board, mark) {
  const opp = opponent(mark)
  let score = 0
  for (const line of WIN_LINES) {
    let mine = 0, theirs = 0
    for (const idx of line) {
      const c = board[idx]
      if (c === mark) mine++
      else if (c === opp) theirs++
    }
    // Lines containing both colors are dead — neither side can win them.
    if (mine > 0 && theirs > 0) continue
    if (mine === 3)      score += 100
    else if (mine === 2) score += 10
    else if (mine === 1) score += 1
    if (theirs === 3)      score -= 100
    else if (theirs === 2) score -= 10
    else if (theirs === 1) score -= 1
  }
  return score
}

/**
 * Alpha-beta search using explicit min/max (clearer than negamax when the
 * evaluator already returns scores from a fixed perspective). `rootMark`
 * is the side scoring is anchored to; `mark` is the side to move at the
 * current node, which alternates each ply.
 *
 * Win/loss scores are biased by `−depth` so that the search prefers
 * faster wins and slower losses — a standard trick that keeps the bot
 * from "wandering" once it sees a forced win N plies out.
 */
export function search(board, mark, depth, alpha, beta, rootMark) {
  const w = getWinner(board)
  // Faster wins / slower losses bias. `depth` counts DOWN as we recurse
  // (root passes `depth = N`, leaves see `depth = 0`), so shallow wins
  // have HIGH depth and deep wins have low depth. Adding `+depth` to the
  // magnitude makes shallow wins score higher than deep wins, and shallow
  // losses score more negative than deep losses — i.e. "win fast, lose
  // slow". The earlier `- depth` form had the opposite effect: a deep
  // forced-win line scored above an immediate win, so the bot wandered.
  if (w) return (w.mark === rootMark ? 1 : -1) * (WIN_SCORE + depth)
  if (isBoardFull(board)) return 0
  if (depth <= 0) return evaluate(board, rootMark)

  const maximizing = (mark === rootMark)
  let best = maximizing ? -Infinity : Infinity

  for (const col of CENTER_ORDER) {
    const result = drop(board, col, mark)
    if (!result) continue
    const value = search(
      result.board, opponent(mark), depth - 1, alpha, beta, rootMark
    )
    if (maximizing) {
      if (value > best) best = value
      if (best > alpha) alpha = best
    } else {
      if (value < best) best = value
      if (best < beta) beta = best
    }
    if (alpha >= beta) break
  }
  return best
}

/**
 * Pick the best column for `mark` at the given search depth.
 * Returns -1 if there are no legal moves (board full).
 *
 * Tie-breaking: among equally-scoring columns, prefers the one earliest
 * in CENTER_ORDER (i.e. closer to the middle). This gives Connect Four's
 * canonical "open with center" behavior for free.
 */
export function bestMove(board, mark, depth) {
  const legal = getLegalMoves(board)
  if (legal.length === 0) return -1

  let bestCol   = -1
  let bestScore = -Infinity
  let alpha     = -Infinity
  const beta    = Infinity

  for (const col of CENTER_ORDER) {
    if (!legal.includes(col)) continue
    const result = drop(board, col, mark)
    if (!result) continue
    const score = search(
      result.board, opponent(mark), depth - 1, alpha, beta, mark
    )
    if (score > bestScore) {
      bestScore = score
      bestCol   = col
      if (score > alpha) alpha = score
    }
  }
  return bestCol
}

/** Map a SDK difficulty label to a minimax depth for built-in personas. */
export const DIFFICULTY_DEPTH = {
  easy:   2,
  medium: 4,
  hard:   6,
  // 'master' is handled by B1.6's master.js, not by depth alone.
  expert: 6,
  beginner: 1,
}
