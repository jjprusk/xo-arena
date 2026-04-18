// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * XO puzzle set — curated board positions with known best moves.
 * Rendered in the Puzzles tab of the platform shell.
 *
 * Each puzzle satisfies the Puzzle interface from @callidity/sdk.
 * initialState matches the XO game state shape (board array + playerMark).
 */

/** @type {import('@callidity/sdk').Puzzle[]} */
export const puzzles = [
  // ── Win in one ────────────────────────────────────────────────────────────
  {
    id:          'xo-win-1',
    title:       'Win in One',
    description: 'X can win immediately. Find the move.',
    difficulty:  'beginner',
    playerMark:  'X',
    initialState: {
      board: ['X', 'O', 'X',
              null, 'O', null,
              null, null, null],
      currentTurn: 'X',
    },
    solution: 6,  // bottom-left completes left column
  },
  {
    id:          'xo-win-2',
    title:       'Diagonal Strike',
    description: 'X has two ways to win. Find either.',
    difficulty:  'beginner',
    playerMark:  'X',
    initialState: {
      board: ['X',  null, null,
              'O',  'X',  'O',
              null, null, null],
      currentTurn: 'X',
    },
    solution: 8,  // bottom-right completes main diagonal
  },

  // ── Block the opponent ────────────────────────────────────────────────────
  {
    id:          'xo-block-1',
    title:       'Stop the Threat',
    description: 'O is about to win. Block it.',
    difficulty:  'beginner',
    playerMark:  'X',
    initialState: {
      board: ['O', null, null,
              null, 'O', null,
              null, null, null],
      currentTurn: 'X',
    },
    solution: 8,  // block bottom-right diagonal
  },
  {
    id:          'xo-block-2',
    title:       'Row Block',
    description: 'O threatens the bottom row. Defend.',
    difficulty:  'beginner',
    playerMark:  'X',
    initialState: {
      board: ['X',  'O',  'X',
              null, null, null,
              'O',  'O',  null],
      currentTurn: 'X',
    },
    solution: 8,  // complete the bottom row block
  },

  // ── Fork ──────────────────────────────────────────────────────────────────
  {
    id:          'xo-fork-1',
    title:       'Create a Fork',
    description: 'X can create two winning threats at once. Find the fork.',
    difficulty:  'intermediate',
    playerMark:  'X',
    initialState: {
      board: ['X',  null, null,
              null, null, null,
              null, null, 'X'],
      currentTurn: 'X',
    },
    solution: 4,  // center creates fork via both diagonals
  },
  {
    id:          'xo-fork-2',
    title:       'Corner Fork',
    description: 'X can force a win with the right corner. Find it.',
    difficulty:  'intermediate',
    playerMark:  'X',
    initialState: {
      board: ['X',  null, null,
              null, 'O',  null,
              null, null, 'X'],
      currentTurn: 'X',
    },
    solution: 2,  // top-right creates two threats
  },

  // ── Survive ───────────────────────────────────────────────────────────────
  {
    id:          'xo-survive-1',
    title:       'Survive the Attack',
    description: 'O threatens multiple wins. Find the only move that avoids losing.',
    difficulty:  'advanced',
    playerMark:  'X',
    initialState: {
      board: [null, 'O',  null,
              'O',  null, null,
              null, null, 'X'],
      currentTurn: 'X',
    },
    solution: 4,  // center is the only move to survive
  },
  {
    id:          'xo-survive-2',
    title:       'Last Stand',
    description: 'X is in trouble. One move prevents an immediate loss.',
    difficulty:  'advanced',
    playerMark:  'X',
    initialState: {
      board: ['O',  null, 'X',
              null, 'O',  null,
              'X',  null, null],
      currentTurn: 'X',
    },
    solution: 7,  // block the bottom-middle or die
  },
]
