/**
 * Minimax AI implementation.
 *
 * Easy   — random valid move
 * Medium — blocks immediate losses and takes immediate wins; otherwise random
 * Hard   — full Minimax lookahead (never loses)
 */

import { getWinner, isBoardFull, getEmptyCells, opponent } from './gameLogic.js'
import { createsFork } from './ruleLogic.js'

/** Pick a random element from an array. */
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * Full Minimax score for a given board position.
 * @param {Array<string|null>} board
 * @param {string} currentPlayer - whose turn it is to move
 * @param {string} aiPlayer - the AI's mark (maximising player)
 * @param {number} depth
 * @returns {number}
 */
function minimax(board, currentPlayer, aiPlayer, depth = 0) {
  const winner = getWinner(board)
  if (winner === aiPlayer) return 10 - depth
  if (winner === opponent(aiPlayer)) return depth - 10
  if (isBoardFull(board)) return 0

  const empty = getEmptyCells(board)
  const isMaximising = currentPlayer === aiPlayer

  let best = isMaximising ? -Infinity : Infinity
  for (const i of empty) {
    const next = [...board]
    next[i] = currentPlayer
    const score = minimax(next, opponent(currentPlayer), aiPlayer, depth + 1)
    best = isMaximising ? Math.max(best, score) : Math.min(best, score)
  }
  return best
}

/**
 * Hard: best move via full Minimax.
 */
function hardMove(board, player) {
  const empty = getEmptyCells(board)
  let bestScore = -Infinity
  let bestMove = empty[0]

  for (const i of empty) {
    const next = [...board]
    next[i] = player
    const score = minimax(next, opponent(player), player, 1)
    if (score > bestScore) {
      bestScore = score
      bestMove = i
    }
  }
  return bestMove
}

/**
 * Medium: win if possible, block opponent win if possible, otherwise random.
 */
function mediumMove(board, player) {
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
 * Easy: random move.
 */
function easyMove(board) {
  return randomChoice(getEmptyCells(board))
}

/**
 * Main entry point for the minimax implementation.
 * Conforms to the AI service interface: (board, difficulty, player) => moveIndex
 *
 * @param {Array<string|null>} board - 9-element board array
 * @param {'easy'|'medium'|'hard'} difficulty
 * @param {'X'|'O'} player - mark the AI is playing
 * @returns {number} - cell index 0–8
 */
export function minimaxMove(board, difficulty, player) {
  switch (difficulty) {
    case 'hard':
      return hardMove(board, player)
    case 'medium':
      return mediumMove(board, player)
    default:
      return easyMove(board)
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
 * @param {'easy'|'medium'|'hard'} difficulty
 */
export function classifyMinimaxMove(board, chosenCell, player, difficulty) {
  if (difficulty === 'easy') return 'random'

  const opp = opponent(player)

  // Rule 1 — Win
  const testWin = [...board]
  testWin[chosenCell] = player
  if (getWinner(testWin) === player) return 'win'

  // Rule 2 — Block
  const testBlock = [...board]
  testBlock[chosenCell] = opp
  if (getWinner(testBlock) === opp) return 'block'

  // Rules 3 & 4 only apply to hard (medium falls through to positional)
  if (difficulty === 'hard') {
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
    'Classic Minimax algorithm. Hard is unbeatable; Medium blocks and takes wins; Easy plays randomly.',
  supportedDifficulties: ['easy', 'medium', 'hard'],
  move: minimaxMove,
}
