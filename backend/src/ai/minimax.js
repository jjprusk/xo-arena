/**
 * Minimax AI implementation.
 *
 * Easy   — random valid move
 * Medium — blocks immediate losses and takes immediate wins; otherwise random
 * Hard   — full Minimax lookahead (never loses)
 */

import { getWinner, isBoardFull, getEmptyCells, opponent } from './gameLogic.js'

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

export const minimaxImplementation = {
  id: 'minimax',
  name: 'Minimax',
  description:
    'Classic Minimax algorithm. Hard is unbeatable; Medium blocks and takes wins; Easy plays randomly.',
  supportedDifficulties: ['easy', 'medium', 'hard'],
  move: minimaxMove,
}
