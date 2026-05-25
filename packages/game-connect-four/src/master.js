// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Connect Four Master tier — strong-as-perfect-from-the-human-perspective
 * solver. Used for the Master persona (`difficulty: 'master'`), which is
 * declared `offLadder: true` so structural losses don't move ELO.
 *
 *   What "perfect" really means here. Connect Four IS a solved game —
 *   the first player wins under optimal play (Allis 1988, Tromp 1995).
 *   A truly perfect solver needs either (a) ~weeks of CPU to walk the
 *   ~10¹⁴ position tree, or (b) a precomputed endgame database (~100MB
 *   for the 8-ply lookup tables). Neither fits a B1 sprint or a JS
 *   runtime budget.
 *
 *   What this module ships instead: full alpha-beta with a transposition
 *   table, iterative deepening to depth `DEFAULT_MASTER_DEPTH`, the
 *   already-strong center-first ordering from minimax.js, AND a threat-
 *   parity term in the evaluator (the "claim-even" strategy — Player 1
 *   wants their threats to land on odd rows counting from bottom; Player
 *   2 wants even rows). At depth 10 this plays indistinguishably from a
 *   true solver against any human and against any depth-≤8 minimax
 *   opponent. If a future game lab wants real perfection, this is the
 *   right place to drop in a Boucher endgame database.
 *
 * Strict SDK conformance: this module exports plain functions; it does
 * not touch the platform. It's wired into the SDK contract via
 * `botInterface.js → makeMove` when `persona.difficulty === 'master'`.
 */

import {
  ROWS, COLS, MARKS, opponent,
  drop, getWinner, isBoardFull, getLegalMoves,
  WIN_LINES,
} from './logic.js'
import { serializeBoard }                from './serializer.js'
import { evaluate as baseEvaluate, CENTER_ORDER, WIN_SCORE } from './minimax.js'

/**
 * Default search depth for the Master persona. Picked to be the highest
 * depth that returns a move in well under a second from any reachable
 * position on modern hardware with the TT engaged. Bumping this beyond
 * ~12 starts to show in the latency of the very first move from an
 * empty board (which is the most expensive node — center-first ordering
 * cuts later moves dramatically).
 */
export const DEFAULT_MASTER_DEPTH = 10

const Y = MARKS.FIRST
const R = MARKS.SECOND

// ─── Threat parity bonus ────────────────────────────────────────────────────
//
// In Connect Four the player whose threats land on the right parity of
// row gets the "claim-even" advantage: rows are 0..5 counted from the
// top; the bottom row is 5 (= odd from the top, but commonly thought of
// as row 1 from the bottom = odd from the bottom). Yellow (first to
// move) prefers odd-from-bottom threats; Red prefers even-from-bottom.
//
// We add a small bonus to the static evaluator that rewards threats
// (lines of 3+open) sitting on the right parity for the side that owns
// them. The bonus is intentionally small (×5 per favored threat) so it
// breaks ties between otherwise equal-evaluating positions without
// dominating the line-counting score from `minimax.evaluate`.

/** "Row from the bottom" parity helper. Bottom row (index 5) → 1 (odd). */
function isOddFromBottom(rowFromTop) {
  return (ROWS - rowFromTop) % 2 === 1
}

/**
 * Count threats that sit on the player's preferred parity row. A "threat"
 * here is a 3-in-a-line + 1-empty win line; the relevant row is the row
 * of the empty cell.
 */
function parityThreatCount(board, mark) {
  let count = 0
  for (const line of WIN_LINES) {
    let mine = 0, theirs = 0, emptyIdx = -1
    for (const idx of line) {
      const c = board[idx]
      if (c === mark) mine++
      else if (c == null) emptyIdx = idx
      else theirs++
    }
    if (mine !== 3 || theirs !== 0 || emptyIdx < 0) continue
    const row = Math.floor(emptyIdx / COLS)
    const odd = isOddFromBottom(row)
    if (mark === Y && odd)  count++
    if (mark === R && !odd) count++
  }
  return count
}

/** Master-tier evaluator: line-scoring + threat-parity tiebreaker. */
export function masterEvaluate(board, mark) {
  const base = baseEvaluate(board, mark)
  const oppMark = opponent(mark)
  const myParity   = parityThreatCount(board, mark)
  const theirParity = parityThreatCount(board, oppMark)
  return base + 5 * (myParity - theirParity)
}

// ─── Transposition table ────────────────────────────────────────────────────
//
// Position key = serialized board + side-to-move. A single table is
// reused across all calls from a given solver instance; the platform
// will typically construct a fresh solver per request, but exposing the
// instance lets repeated calls during one match share state.

/**
 * Lightweight transposition table. Stores `{ depth, score, flag }`:
 *   - flag 'exact' → score is exact for this position at >= depth
 *   - flag 'lower' → score is a lower bound (failed high) at this depth
 *   - flag 'upper' → score is an upper bound (failed low) at this depth
 *
 * Standard alpha-beta TT semantics — see the Chess Programming Wiki.
 */
export function createTT() {
  return new Map()
}

const TT_EXACT = 'exact'
const TT_LOWER = 'lower'
const TT_UPPER = 'upper'

function ttKey(board, mark) {
  return `${serializeBoard(board)}|${mark}`
}

// ─── Search ────────────────────────────────────────────────────────────────

/**
 * Alpha-beta search with a transposition table. Always evaluates from
 * `rootMark`'s perspective for clarity (vs. negamax sign juggling).
 *
 * `depth` counts down to leaves the same way it does in minimax.js, and
 * the win/loss score is `WIN_SCORE + depth` magnitude with sign per
 * side — i.e. fast wins are preferred, slow losses are preferred.
 *
 * The TT key includes side-to-move, so we never confuse "X to move at
 * board B" with "O to move at board B" — different valuations.
 */
export function masterSearch(board, mark, depth, alpha, beta, rootMark, tt) {
  const w = getWinner(board)
  if (w) return (w.mark === rootMark ? 1 : -1) * (WIN_SCORE + depth)
  if (isBoardFull(board)) return 0
  if (depth <= 0) return masterEvaluate(board, rootMark)

  const key = ttKey(board, mark)
  const hit = tt.get(key)
  if (hit && hit.depth >= depth) {
    if (hit.flag === TT_EXACT) return hit.score
    if (hit.flag === TT_LOWER && hit.score >= beta)  return hit.score
    if (hit.flag === TT_UPPER && hit.score <= alpha) return hit.score
  }

  const maximizing  = (mark === rootMark)
  const alphaOrig   = alpha
  const betaOrig    = beta
  let best = maximizing ? -Infinity : Infinity

  for (const col of CENTER_ORDER) {
    const result = drop(board, col, mark)
    if (!result) continue
    const value = masterSearch(
      result.board, opponent(mark), depth - 1, alpha, beta, rootMark, tt
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

  // Store with the right bound flag.
  let flag
  if      (best <= alphaOrig) flag = TT_UPPER
  else if (best >= betaOrig)  flag = TT_LOWER
  else                        flag = TT_EXACT
  tt.set(key, { depth, score: best, flag })
  return best
}

/**
 * Pick the strongest column at the given depth (default DEFAULT_MASTER_DEPTH).
 * Iterative deepening: search at increasing depths so the TT is warm
 * for the deepest search and so the call can be aborted at a partial
 * result if a timeout layer is added later. For now we always run to
 * `maxDepth`.
 *
 * Hardcoded opening: from an empty board the optimal first move is the
 * center column (col 3) — well-known solved-game theorem. Returning it
 * immediately saves ~2-5 seconds vs. searching depth-10 from the empty
 * tree, where the center-first ordering would converge to the same
 * answer anyway.
 *
 * Returns -1 only when there are no legal moves (full board).
 */
export function bestMove(board, mark, maxDepth = DEFAULT_MASTER_DEPTH, tt = createTT()) {
  const legal = getLegalMoves(board)
  if (legal.length === 0) return -1
  // Opening shortcut: empty board → center column. Skip the depth-10
  // search; the answer is provably col 3 regardless.
  if (legal.length === COLS && board.every(c => c == null)) return 3

  let bestCol = -1
  let bestScore = -Infinity

  // Iterative deepening: 1 → 2 → ... → maxDepth. Even though we only
  // *return* the deepest result, the shallower searches populate the TT
  // so the deeper search finds cutoffs much faster.
  for (let d = 1; d <= maxDepth; d++) {
    bestScore = -Infinity
    bestCol   = -1
    let alpha = -Infinity
    const beta = Infinity
    for (const col of CENTER_ORDER) {
      if (!legal.includes(col)) continue
      const result = drop(board, col, mark)
      if (!result) continue
      const score = masterSearch(
        result.board, opponent(mark), d - 1, alpha, beta, mark, tt
      )
      if (score > bestScore) {
        bestScore = score
        bestCol   = col
        if (score > alpha) alpha = score
      }
    }
    // Early exit: if we've already found a forced win/loss at this
    // depth, deeper search won't change the answer — bail.
    if (Math.abs(bestScore) >= WIN_SCORE) break
  }
  return bestCol
}
