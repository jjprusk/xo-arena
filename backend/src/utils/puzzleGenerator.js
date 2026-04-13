// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tactical puzzle generator for tic-tac-toe.
 *
 * Types:
 *   win1    — find the one move that wins immediately
 *   block1  — block the opponent's winning threat
 *   fork    — create two simultaneous winning threats
 *   survive — only move(s) that avoid a forced loss
 */

import { getWinner, isBoardFull, getEmptyCells, opponent, createsFork } from '@xo-arena/ai'

// ─── Internal minimax (not exported from minimax.js) ─────────────────────────

function minimaxScore(board, currentPlayer, perspective, depth = 0) {
  const winner = getWinner(board)
  if (winner === perspective) return 10 - depth
  if (winner && winner !== perspective) return depth - 10
  if (isBoardFull(board)) return 0

  const empty = getEmptyCells(board)
  const isMax = currentPlayer === perspective
  let best = isMax ? -Infinity : Infinity
  for (const i of empty) {
    const next = [...board]
    next[i] = currentPlayer
    const score = minimaxScore(next, opponent(currentPlayer), perspective, depth + 1)
    best = isMax ? Math.max(best, score) : Math.min(best, score)
  }
  return best
}

// ─── Board generation ─────────────────────────────────────────────────────────

/** Shuffle an array in-place (Fisher-Yates). */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Generate a random board with xCount X's and oCount O's.
 * Returns null if the generated board already has a winner.
 */
function randomBoard(xCount, oCount) {
  const positions = shuffle(Array.from({ length: 9 }, (_, i) => i))
  const board = Array(9).fill(null)
  for (let i = 0; i < xCount; i++) board[positions[i]] = 'X'
  for (let i = 0; i < oCount; i++) board[positions[xCount + i]] = 'O'
  return getWinner(board) === null ? board : null
}

/**
 * Optionally flip the board by swapping X↔O and returning O as toPlay.
 * Tic-tac-toe is symmetric so the puzzle remains valid.
 */
function maybeFlip(puzzle) {
  if (Math.random() < 0.5) return puzzle
  return {
    ...puzzle,
    board: puzzle.board.map(c => c === 'X' ? 'O' : c === 'O' ? 'X' : null),
    toPlay: opponent(puzzle.toPlay),
  }
}

// ─── Generators ───────────────────────────────────────────────────────────────

export function generateWin1Puzzle() {
  for (let attempt = 0; attempt < 3000; attempt++) {
    const total = 2 + Math.floor(Math.random() * 5) // 2–6 pieces on board
    const xCount = Math.ceil(total / 2)
    const oCount = Math.floor(total / 2)
    const board = randomBoard(xCount, oCount)
    if (!board) continue

    const empty = getEmptyCells(board)
    const winMoves = empty.filter(i => {
      const b = [...board]; b[i] = 'X'; return getWinner(b) === 'X'
    })
    if (winMoves.length !== 1) continue

    return maybeFlip({
      board,
      solutions: winMoves,
      type: 'win1',
      toPlay: 'X',
      title: 'Win in 1',
      description: 'Find the move that wins immediately.',
    })
  }
  return null
}

export function generateBlock1Puzzle() {
  for (let attempt = 0; attempt < 3000; attempt++) {
    const total = 2 + Math.floor(Math.random() * 5)
    const xCount = Math.ceil(total / 2)
    const oCount = Math.floor(total / 2)
    const board = randomBoard(xCount, oCount)
    if (!board) continue

    const empty = getEmptyCells(board)

    // X has no immediate win
    const xWins = empty.filter(i => { const b = [...board]; b[i] = 'X'; return getWinner(b) === 'X' })
    if (xWins.length > 0) continue

    // O must have at least one winning threat
    const oWins = empty.filter(i => { const b = [...board]; b[i] = 'O'; return getWinner(b) === 'O' })
    if (oWins.length === 0) continue

    return maybeFlip({
      board,
      solutions: oWins, // blocking = cover the threatening cell
      type: 'block1',
      toPlay: 'X',
      title: 'Block the Win',
      description: "Stop your opponent from winning next turn.",
    })
  }
  return null
}

export function generateForkPuzzle() {
  for (let attempt = 0; attempt < 3000; attempt++) {
    const total = 2 + Math.floor(Math.random() * 4) // 2–5 pieces — need room to fork
    const xCount = Math.ceil(total / 2)
    const oCount = Math.floor(total / 2)
    const board = randomBoard(xCount, oCount)
    if (!board) continue

    const empty = getEmptyCells(board)

    // X has no immediate win (that would be win1, not fork)
    const xWins = empty.filter(i => { const b = [...board]; b[i] = 'X'; return getWinner(b) === 'X' })
    if (xWins.length > 0) continue

    const forkMoves = empty.filter(i => createsFork(board, i, 'X'))
    if (forkMoves.length === 0) continue

    return maybeFlip({
      board,
      solutions: forkMoves,
      type: 'fork',
      toPlay: 'X',
      title: 'Create a Fork',
      description: 'Find the move that sets up two simultaneous winning threats.',
    })
  }
  return null
}

export function generateSurvivePuzzle() {
  for (let attempt = 0; attempt < 3000; attempt++) {
    const total = 3 + Math.floor(Math.random() * 4) // 3–6 pieces
    const xCount = Math.ceil(total / 2)
    const oCount = Math.floor(total / 2)
    const board = randomBoard(xCount, oCount)
    if (!board) continue

    const empty = getEmptyCells(board)
    if (empty.length < 3) continue

    // X has no immediate win
    const xWins = empty.filter(i => { const b = [...board]; b[i] = 'X'; return getWinner(b) === 'X' })
    if (xWins.length > 0) continue

    // O must have at least one winning threat (makes it feel urgent)
    const oWins = empty.filter(i => { const b = [...board]; b[i] = 'O'; return getWinner(b) === 'O' })
    if (oWins.length === 0) continue

    // Evaluate minimax outcome for each X move
    const surviveMoves = []
    const lossMoves = []
    for (const i of empty) {
      const b = [...board]; b[i] = 'X'
      const score = minimaxScore(b, 'O', 'X', 1)
      if (score >= 0) surviveMoves.push(i)
      else lossMoves.push(i)
    }

    // Interesting if some moves lose and 1–2 moves survive
    if (surviveMoves.length === 0 || lossMoves.length === 0) continue
    if (surviveMoves.length > 2) continue // too easy

    return maybeFlip({
      board,
      solutions: surviveMoves,
      type: 'survive',
      toPlay: 'X',
      title: 'Draw or Die',
      description: 'Most moves here lead to a loss — find the one that survives.',
    })
  }
  return null
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const PUZZLE_TYPES = {
  win1: generateWin1Puzzle,
  block1: generateBlock1Puzzle,
  fork: generateForkPuzzle,
  survive: generateSurvivePuzzle,
}

export const PUZZLE_META = {
  win1:    { label: 'Win in 1',   color: 'var(--color-teal-600)' },
  block1:  { label: 'Block',      color: 'var(--color-blue-600)' },
  fork:    { label: 'Fork',       color: 'var(--color-amber-600)' },
  survive: { label: 'Draw or Die', color: 'var(--color-red-600)' },
}
