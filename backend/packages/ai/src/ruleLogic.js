// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Shared rule logic — used by the Minimax classifier, the rule extraction
 * service, and the rule-based AI player.
 */

import { getWinner, getEmptyCells, opponent } from './gameLogic.js'

/** Canonical rule IDs in default priority order. */
export const RULE_IDS = [
  'win', 'block', 'fork', 'block_fork',
  'center', 'opposite_corner', 'corner', 'side',
]

/** Human-readable metadata for each rule. */
export const RULE_META = {
  win:             { label: 'Win',             desc: 'Complete a two-in-a-row to win immediately' },
  block:           { label: 'Block',           desc: "Stop the opponent's two-in-a-row threat" },
  fork:            { label: 'Fork',            desc: 'Create two simultaneous winning threats' },
  block_fork:      { label: 'Block fork',      desc: 'Deny the opponent a fork opportunity' },
  center:          { label: 'Center',          desc: 'Take the center square for maximum control' },
  opposite_corner: { label: 'Opposite corner', desc: "Play opposite the opponent's corner to neutralise it" },
  corner:          { label: 'Corner',          desc: 'Claim an empty corner' },
  side:            { label: 'Side',            desc: 'Play an empty side square' },
}

/**
 * Returns true if placing `player` at `cell` on `board` creates two or more
 * simultaneous winning threats (a "fork").
 */
export function createsFork(board, cell, player) {
  const next = [...board]
  next[cell] = player
  const empty = getEmptyCells(next)
  let threats = 0
  for (const i of empty) {
    const test = [...next]
    test[i] = player
    if (getWinner(test) === player) threats++
  }
  return threats >= 2
}

/**
 * Apply a named rule to a board position.
 * Returns the first recommended cell index, or null if the rule doesn't apply.
 *
 * @param {Array<string|null>} board
 * @param {string} mark   The mark of the player applying the rule ('X' | 'O')
 * @param {string} ruleId One of RULE_IDS
 */
export function applyRule(board, mark, ruleId) {
  const opp = opponent(mark)
  const empty = getEmptyCells(board)

  switch (ruleId) {
    case 'win': {
      for (const i of empty) {
        const test = [...board]; test[i] = mark
        if (getWinner(test) === mark) return i
      }
      return null
    }
    case 'block': {
      for (const i of empty) {
        const test = [...board]; test[i] = opp
        if (getWinner(test) === opp) return i
      }
      return null
    }
    case 'fork': {
      for (const i of empty) {
        if (createsFork(board, i, mark)) return i
      }
      return null
    }
    case 'block_fork': {
      for (const i of empty) {
        if (createsFork(board, i, opp)) return i
      }
      return null
    }
    case 'center':
      return board[4] === null ? 4 : null
    case 'opposite_corner': {
      const pairs = [[0, 8], [2, 6], [6, 2], [8, 0]]
      for (const [c, c2] of pairs) {
        if (board[c] === opp && board[c2] === null) return c2
      }
      return null
    }
    case 'corner': {
      const corners = [0, 2, 6, 8].filter(i => board[i] === null)
      return corners.length > 0 ? corners[0] : null
    }
    case 'side': {
      const sides = [1, 3, 5, 7].filter(i => board[i] === null)
      return sides.length > 0 ? sides[0] : null
    }
    default:
      return null
  }
}

/**
 * Pure synchronous rule-based move.
 * `rules` is a pre-loaded array of rule objects `{ id, priority?, enabled? }`,
 * sorted by priority ascending. The platform bot dispatcher is responsible for
 * loading the rule set from the database and passing it here as `weights.rules`.
 *
 * Falls back to a random legal move if no rule applies or no rules provided.
 *
 * @param {Array<string|null>} board
 * @param {string} mark    'X' | 'O'
 * @param {Array<{id: string}>} rules
 * @returns {number}
 */
export function ruleBasedMove(board, mark, rules = []) {
  const empty = getEmptyCells(board)
  if (empty.length === 0) return -1

  for (const rule of rules) {
    const move = applyRule(board, mark, rule.id)
    if (move !== null) return move
  }

  return empty[Math.floor(Math.random() * empty.length)]
}
