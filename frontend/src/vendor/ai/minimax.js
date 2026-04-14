// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Minimax AI implementation.
 *
 * Novice       — random valid move
 * Intermediate — blocks immediate losses and takes immediate wins; otherwise random
 * Advanced     — same as intermediate but 60% of the time plays the optimal minimax move
 * Master       — full Minimax lookahead (never loses)
 */

import { getWinner, isBoardFull, getEmptyCells, opponent } from './gameLogic.js'
import { createsFork } from './ruleLogic.js'

/** Pick a random element from an array. */
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * Transposition table — persists across calls.
 * Key: 9-char board string + 1-char current player ('X' or 'O').
 * Value: score in [-1, 0, 1] from currentPlayer's perspective.
 * Bounded by ~5,477 unique tic-tac-toe positions × 2 players = ~10,954 entries.
 */
const _ttable = new Map()

/**
 * Negamax with transposition table (replaces full Minimax).
 *
 * Returns +1 if currentPlayer wins with best play, -1 if loses, 0 if draw.
 * Mutates board in-place and restores — avoids array copies on every call.
 */
function negamax(board, currentPlayer) {
  const winner = getWinner(board)
  if (winner === currentPlayer)          return 1
  if (winner === opponent(currentPlayer)) return -1
  if (isBoardFull(board))                return 0

  const key = board.map(c => c ?? '.').join('') + currentPlayer
  const cached = _ttable.get(key)
  if (cached !== undefined) return cached

  const empty = getEmptyCells(board)
  let best = -Infinity
  for (const i of empty) {
    board[i] = currentPlayer
    const score = -negamax(board, opponent(currentPlayer))
    board[i] = null
    if (score > best) {
      best = score
      if (best === 1) break  // can't do better than immediate win
    }
  }

  _ttable.set(key, best)
  return best
}

/**
 * Master: best move via Negamax + transposition table.
 * Immediate wins and blocks are checked first for performance and determinism.
 */
function masterMove(board, player) {
  const empty = getEmptyCells(board)
  const opp = opponent(player)

  // Take immediate win
  for (const i of empty) {
    board[i] = player
    const wins = getWinner(board) === player
    board[i] = null
    if (wins) return i
  }

  // Block immediate opponent win
  for (const i of empty) {
    board[i] = opp
    const oppWins = getWinner(board) === opp
    board[i] = null
    if (oppWins) return i
  }

  let bestScore = -Infinity
  let bestMove = empty[0]

  for (const i of empty) {
    board[i] = player
    const score = -negamax(board, opp)
    board[i] = null
    if (score > bestScore) {
      bestScore = score
      bestMove = i
      if (bestScore === 1) break  // found a winning move, stop searching
    }
  }
  return bestMove
}

/**
 * Intermediate: win if possible, block opponent win if possible, otherwise random.
 */
function intermediateMove(board, player) {
  const empty = getEmptyCells(board)
  const opp = opponent(player)

  // Take winning move
  for (const i of empty) {
    const next = [...board]
    next[i] = player
    if (getWinner(next) === player) return i
  }

  // Block opponent win
  for (const i of empty) {
    const next = [...board]
    next[i] = opp
    if (getWinner(next) === opp) return i
  }

  return randomChoice(empty)
}

/**
 * Advanced: win if possible, block opponent win if possible, then
 * 60% of the time play the optimal minimax move — otherwise random.
 */
function advancedMove(board, player) {
  const empty = getEmptyCells(board)
  const opp = opponent(player)

  // Take winning move
  for (const i of empty) {
    const next = [...board]
    next[i] = player
    if (getWinner(next) === player) return i
  }

  // Block opponent win
  for (const i of empty) {
    const next = [...board]
    next[i] = opp
    if (getWinner(next) === opp) return i
  }

  return Math.random() < 0.6 ? masterMove(board, player) : randomChoice(empty)
}

/**
 * Novice: random move.
 */
function noviceMove(board) {
  return randomChoice(getEmptyCells(board))
}

/**
 * Main entry point for the minimax implementation.
 * Conforms to the AI service interface: (board, difficulty, player) => moveIndex
 *
 * @param {Array<string|null>} board - 9-element board array
 * @param {'novice'|'intermediate'|'advanced'|'master'} difficulty
 * @param {'X'|'O'} player - mark the AI is playing
 * @returns {number} - cell index 0–8
 */
export function minimaxMove(board, difficulty, player) {
  switch (difficulty) {
    case 'master':
      return masterMove(board, player)
    case 'advanced':
      return advancedMove(board, player)
    case 'intermediate':
      return intermediateMove(board, player)
    default:
      return noviceMove(board)
  }
}

// ─── Move classification ──────────────────────────────────────────────────────

/**
 * Classify the strategic rule that best explains why `chosenCell` was played.
 * Returns one of: 'win' | 'block' | 'fork' | 'block_fork' | 'center' |
 *                 'opposite_corner' | 'corner' | 'side' | 'random'
 *
 * @param {Array<string|null>} board   Board state BEFORE the move
 * @param {number}             chosenCell
 * @param {string}             player  The AI's mark
 * @param {'novice'|'intermediate'|'advanced'|'master'} difficulty
 */
export function classifyMinimaxMove(board, chosenCell, player, difficulty) {
  if (difficulty === 'novice') return 'random'

  const opp = opponent(player)

  // Rule 1 — Win
  const testWin = [...board]
  testWin[chosenCell] = player
  if (getWinner(testWin) === player) return 'win'

  // Rule 2 — Block
  const testBlock = [...board]
  testBlock[chosenCell] = opp
  if (getWinner(testBlock) === opp) return 'block'

  // Rules 3 & 4 apply to master and advanced (both can play fork moves)
  if (difficulty === 'master' || difficulty === 'advanced') {
    // Rule 3 — Fork
    if (createsFork(board, chosenCell, player)) return 'fork'

    // Rule 4 — Block fork
    if (createsFork(board, chosenCell, opp)) return 'block_fork'
  }

  // Rule 5 — Center
  if (chosenCell === 4) return 'center'

  // Rule 6 — Opposite corner
  const cornerPairs = [[0, 8], [2, 6], [6, 2], [8, 0]]
  for (const [c, opp_c] of cornerPairs) {
    if (board[c] === opp && chosenCell === opp_c) return 'opposite_corner'
  }

  // Rule 7 — Empty corner
  if ([0, 2, 6, 8].includes(chosenCell)) return 'corner'

  // Rule 8 — Side
  return 'side'
}

export const minimaxImplementation = {
  id: 'minimax',
  name: 'Minimax',
  description:
    'Classic Minimax algorithm. Master is unbeatable; Advanced usually plays optimally; Intermediate blocks and takes wins; Novice plays randomly.',
  supportedDifficulties: ['novice', 'intermediate', 'advanced', 'master'],
  move: minimaxMove,
}
