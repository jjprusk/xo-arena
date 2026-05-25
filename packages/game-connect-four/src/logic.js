// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Connect Four game logic — pure functions, no platform dependencies.
 *
 * Board representation:
 *   - 1D array of length 42 (6 rows × 7 columns), row-major.
 *   - Index = row * 7 + col, with row 0 = top, row 5 = bottom.
 *   - Cell value is null (empty), 'Y' (Yellow, first to move), or 'R' (Red).
 *
 * Move representation:
 *   - A column index in [0, 6]. Gravity drops the piece to the lowest empty
 *     row in that column. `drop()` returns the new board (immutable update)
 *     or null if the column is already full.
 *
 * Win representation:
 *   - Any line of four consecutive same-marked cells in any of the four
 *     directions: horizontal, vertical, down-right diagonal, down-left
 *     diagonal. WIN_LINES enumerates all 69 possible four-in-a-row lines
 *     once at module load.
 *
 * Win-line counts (geometry-verified):
 *   - horizontal:    6 rows × (7 − 3) = 24
 *   - vertical:      (6 − 3) × 7      = 21
 *   - diag ↘ (down-right): (6 − 3) × (7 − 3) = 12
 *   - diag ↙ (down-left ): (6 − 3) × (7 − 3) = 12
 *   - total:                                  = 69
 */

export const ROWS  = 6
export const COLS  = 7
export const CELLS = ROWS * COLS // 42
export const WIN_RUN = 4

/** Players. 'Y' (Yellow) moves first; 'R' (Red) is second. */
export const MARKS = { FIRST: 'Y', SECOND: 'R' }

/** Convert (row, col) → flat index. Caller must ensure both are in range. */
export function indexOf(row, col) {
  return row * COLS + col
}

/** Inverse of indexOf. */
export function coordsOf(index) {
  return { row: Math.floor(index / COLS), col: index % COLS }
}

/** Return a fresh empty board (null × 42). */
export function emptyBoard() {
  return Array(CELLS).fill(null)
}

/** Return the opposite mark. Throws on unknown input — fail loud, not silent. */
export function opponent(mark) {
  if (mark === MARKS.FIRST)  return MARKS.SECOND
  if (mark === MARKS.SECOND) return MARKS.FIRST
  throw new Error(`opponent(): unknown mark ${JSON.stringify(mark)}`)
}

/**
 * Precomputed list of every four-in-a-row line, as arrays of four flat
 * indices. Built once at module load; getWinner iterates it.
 */
export const WIN_LINES = (() => {
  const lines = []
  // Horizontal: every row, sliding window of 4 across columns.
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - WIN_RUN; c++) {
      lines.push([indexOf(r, c), indexOf(r, c + 1), indexOf(r, c + 2), indexOf(r, c + 3)])
    }
  }
  // Vertical: every column, sliding window of 4 down rows.
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r <= ROWS - WIN_RUN; r++) {
      lines.push([indexOf(r, c), indexOf(r + 1, c), indexOf(r + 2, c), indexOf(r + 3, c)])
    }
  }
  // Diagonal ↘ (down-right): start cells where 3 rows below + 3 cols right fit.
  for (let r = 0; r <= ROWS - WIN_RUN; r++) {
    for (let c = 0; c <= COLS - WIN_RUN; c++) {
      lines.push([indexOf(r, c), indexOf(r + 1, c + 1), indexOf(r + 2, c + 2), indexOf(r + 3, c + 3)])
    }
  }
  // Diagonal ↙ (down-left): start cells where 3 rows below + 3 cols left fit.
  for (let r = 0; r <= ROWS - WIN_RUN; r++) {
    for (let c = WIN_RUN - 1; c < COLS; c++) {
      lines.push([indexOf(r, c), indexOf(r + 1, c - 1), indexOf(r + 2, c - 2), indexOf(r + 3, c - 3)])
    }
  }
  return lines
})()

/**
 * Find the lowest empty row in `col`. Returns -1 if the column is full.
 * "Lowest" = highest row index (since row 5 is the bottom).
 */
export function lowestEmptyRow(board, col) {
  if (col < 0 || col >= COLS) return -1
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[indexOf(r, col)] == null) return r
  }
  return -1
}

/**
 * Return the list of columns where a piece can still be dropped (top row
 * still empty). Result is in column order [0..6], filtered.
 */
export function getLegalMoves(board) {
  const moves = []
  for (let c = 0; c < COLS; c++) {
    if (board[indexOf(0, c)] == null) moves.push(c)
  }
  return moves
}

/**
 * Drop `mark` into `col`. Returns { board, row, index } describing the new
 * state, or null if the column is full / out of bounds / mark is invalid.
 * The returned board is a new array — the input is not mutated.
 */
export function drop(board, col, mark) {
  if (mark !== MARKS.FIRST && mark !== MARKS.SECOND) return null
  const row = lowestEmptyRow(board, col)
  if (row < 0) return null
  const next = board.slice()
  const idx  = indexOf(row, col)
  next[idx]  = mark
  return { board: next, row, index: idx }
}

/**
 * Return the winning mark + winning line if any side has four in a row.
 * Returns null if no winner. Iterates WIN_LINES once; O(69 × 4).
 */
export function getWinner(board) {
  for (const line of WIN_LINES) {
    const a = board[line[0]]
    if (a == null) continue
    if (a === board[line[1]] && a === board[line[2]] && a === board[line[3]]) {
      return { mark: a, line }
    }
  }
  return null
}

/** True when every cell is filled. */
export function isBoardFull(board) {
  for (let i = 0; i < CELLS; i++) if (board[i] == null) return false
  return true
}

/**
 * Convenience terminal-state classifier.
 *   { status: 'in_progress' }              — game ongoing
 *   { status: 'win', mark, line }          — someone has four in a row
 *   { status: 'draw' }                     — board full, no winner
 */
export function gameStatus(board) {
  const w = getWinner(board)
  if (w) return { status: 'win', mark: w.mark, line: w.line }
  if (isBoardFull(board)) return { status: 'draw' }
  return { status: 'in_progress' }
}
