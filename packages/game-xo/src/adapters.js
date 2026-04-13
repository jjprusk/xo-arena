// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * XO AI adapters — bridge between the game state representation and
 * the general-purpose AI algorithms in @xo-arena/ai.
 *
 * These are passed into botInterface methods so algorithms can operate
 * on XO boards without game-specific knowledge baked in.
 */

import { getEmptyCells } from '@xo-arena/ai'

/**
 * Serialize a board state to the format expected by neural-net / DQN / AlphaZero.
 * Returns a 9-element array: 1 = X, -1 = O, 0 = empty.
 * Perspective is always from the viewpoint of X by default;
 * pass playerMark to flip the perspective.
 */
export function serializeState(state, playerMark = 'X') {
  const board = Array.isArray(state) ? state : state.board
  return board.map(cell => {
    if (cell === null)        return 0
    if (cell === playerMark)  return 1
    return -1
  })
}

/**
 * Deserialize a raw stored move back to a cell index.
 * Moves are stored as numbers 0-8.
 */
export function deserializeMove(raw) {
  return Number(raw)
}

/**
 * Return legal move indices (empty cells) for the given board.
 * Used by MCTS, minimax masked softmax, and policy gradient.
 */
export function getLegalMoves(state) {
  const board = Array.isArray(state) ? state : state.board
  return getEmptyCells(board)
}
