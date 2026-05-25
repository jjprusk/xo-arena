// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Connect Four serialization — compact, human-inspectable, round-trip safe.
 *
 * Format: a 42-char string mirroring the row-major board, plus an optional
 * '|<turn>' suffix when serializing whole game state:
 *
 *   '.......' × 6 rows  → empty
 *   '.' = empty, 'Y' = Yellow, 'R' = Red
 *
 * Examples:
 *   serializeBoard(empty)              → '..........................................'
 *   serializeBoard(YinBottomLeft)      → '.....................................Y.....'
 *   serializeState({ board, turn })    → '...........|Y' (turn appended after '|')
 *
 * Why a string rather than the raw array?
 *   - Compact: 42 bytes vs the JSON of a 42-element array (~210 bytes).
 *   - Replay-friendly: stable on-the-wire form for DB storage.
 *   - Bot input ready: most tabular learners hash the string directly as
 *     the state key, no extra normalization step.
 *
 * The encoding is intentionally not base-3-packed — debuggability wins
 * over the additional 75% size savings for a board that fits in a tweet.
 */

import { CELLS, MARKS, emptyBoard } from './logic.js'

const EMPTY_CHAR = '.'
const VALID_MARK_CHARS = new Set([MARKS.FIRST, MARKS.SECOND, EMPTY_CHAR])

/** Encode a board (length-42 array) to a 42-char string. */
export function serializeBoard(board) {
  if (!Array.isArray(board) || board.length !== CELLS) {
    throw new Error(`serializeBoard: expected length-${CELLS} array, got ${board?.length}`)
  }
  let out = ''
  for (let i = 0; i < CELLS; i++) {
    const cell = board[i]
    out += cell == null ? EMPTY_CHAR : cell
  }
  return out
}

/** Decode a 42-char string back into a board (length-42 array). */
export function deserializeBoard(str) {
  if (typeof str !== 'string' || str.length !== CELLS) {
    throw new Error(`deserializeBoard: expected length-${CELLS} string, got ${str?.length}`)
  }
  const board = emptyBoard()
  for (let i = 0; i < CELLS; i++) {
    const ch = str[i]
    if (!VALID_MARK_CHARS.has(ch)) {
      throw new Error(`deserializeBoard: invalid char ${JSON.stringify(ch)} at index ${i}`)
    }
    board[i] = ch === EMPTY_CHAR ? null : ch
  }
  return board
}

/**
 * Encode whole-game state to '<board>|<turn>'. Turn must be a valid mark.
 * Use this when persisting mid-game state where the turn-to-move matters
 * (the board alone doesn't tell you whose turn it is in C4 because both
 * sides may have legally arrived at any move count).
 */
export function serializeState({ board, turn }) {
  if (turn !== MARKS.FIRST && turn !== MARKS.SECOND) {
    throw new Error(`serializeState: invalid turn ${JSON.stringify(turn)}`)
  }
  return `${serializeBoard(board)}|${turn}`
}

/** Decode '<board>|<turn>' produced by serializeState. */
export function deserializeState(str) {
  if (typeof str !== 'string') {
    throw new Error(`deserializeState: expected string, got ${typeof str}`)
  }
  const pipe = str.indexOf('|')
  if (pipe < 0) throw new Error(`deserializeState: missing '|' separator`)
  const boardStr = str.slice(0, pipe)
  const turn     = str.slice(pipe + 1)
  if (turn !== MARKS.FIRST && turn !== MARKS.SECOND) {
    throw new Error(`deserializeState: invalid turn ${JSON.stringify(turn)}`)
  }
  return { board: deserializeBoard(boardStr), turn }
}
