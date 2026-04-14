// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * XO game logic — re-exports from @xo-arena/ai plus XO-specific helpers.
 * All functions are pure (no side effects, no platform dependencies).
 */

export {
  getWinner,
  isBoardFull,
  getEmptyCells,
  opponent,
  WIN_LINES,
} from '@xo-arena/ai'

/**
 * Return the mark ('X' or 'O') that belongs to the given userId,
 * using the marks map stored in session.settings.
 */
export function getMyMark(session) {
  return session?.settings?.marks?.[session?.currentUserId] ?? null
}

/**
 * Return initial game state for a new round.
 */
export function initialGameState() {
  return {
    board:       Array(9).fill(null),
    currentTurn: 'X',
    status:      'playing',
    winner:      null,
    winLine:     null,
    scores:      { X: 0, O: 0 },
    round:       1,
  }
}
