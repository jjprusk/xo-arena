/**
 * Core game logic utilities shared across AI implementations and tests.
 */

/** All winning combinations (indices into the 9-cell board array). */
export const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

/**
 * Returns the winner ('X' or 'O') if there is one, otherwise null.
 * @param {Array<string|null>} board - 9-element board array
 */
export function getWinner(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a]
    }
  }
  return null
}

/**
 * Returns true if the board is full (draw condition when no winner).
 * @param {Array<string|null>} board
 */
export function isBoardFull(board) {
  return board.every((cell) => cell !== null)
}

/**
 * Returns array of indices for empty cells.
 * @param {Array<string|null>} board
 */
export function getEmptyCells(board) {
  return board.reduce((acc, cell, i) => {
    if (cell === null) acc.push(i)
    return acc
  }, [])
}

/**
 * Returns the opponent's mark.
 * @param {'X'|'O'} player
 */
export function opponent(player) {
  return player === 'X' ? 'O' : 'X'
}
