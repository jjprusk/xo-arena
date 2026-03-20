/**
 * Puzzle Mode — tactical tic-tac-toe puzzles.
 * Each puzzle presents a board position; the player must find the best move.
 * Best move is validated against minimax at hard difficulty.
 */

import React, { useState, useCallback } from 'react'
import { api } from '../lib/api.js'

const MARK_COLOR = {
  X: 'var(--color-blue-600)',
  O: 'var(--color-teal-600)',
}

// Curated puzzle library
// board: 9-element array (null / 'X' / 'O'), toPlay: mark whose turn it is
// description: what to find, hint: optional strategic hint
const PUZZLES = [
  {
    id: 'p1',
    title: 'Win in one',
    description: 'X to play — find the winning move.',
    toPlay: 'X',
    board: ['X', null, 'X', 'O', 'O', null, null, null, null],
  },
  {
    id: 'p2',
    title: 'Block the win',
    description: 'O to play — stop X from winning next turn.',
    toPlay: 'O',
    board: ['X', null, 'X', null, 'O', null, null, null, null],
  },
  {
    id: 'p3',
    title: 'Fork setup',
    description: 'X to play — create two simultaneous threats.',
    toPlay: 'X',
    board: ['X', null, null, null, 'O', null, null, null, 'X'],
  },
  {
    id: 'p4',
    title: 'Block the fork',
    description: 'O to play — prevent X from forking.',
    toPlay: 'O',
    board: ['X', null, null, null, 'O', null, null, null, 'X'],
  },
  {
    id: 'p5',
    title: 'Corner counter',
    description: 'O to play — X took a corner. Best response.',
    toPlay: 'O',
    board: ['X', null, null, null, null, null, null, null, null],
  },
  {
    id: 'p6',
    title: 'Diagonal threat',
    description: 'X to play — exploit the diagonal.',
    toPlay: 'X',
    board: ['X', 'O', null, null, 'X', null, null, null, null],
  },
  {
    id: 'p7',
    title: 'Two threats',
    description: 'X to play — find the move that creates two winning threats.',
    toPlay: 'X',
    board: ['X', null, null, null, 'X', 'O', null, null, null],
  },
  {
    id: 'p8',
    title: 'Endgame accuracy',
    description: 'O to play — only one move avoids losing.',
    toPlay: 'O',
    board: ['X', 'O', 'X', null, 'X', null, 'O', null, null],
  },
]

export default function PuzzlePage() {
  const [puzzleIdx, setPuzzleIdx] = useState(0)
  const [result, setResult] = useState(null)   // null | 'correct' | 'wrong'
  const [bestMove, setBestMove] = useState(null)
  const [checking, setChecking] = useState(false)
  const [solvedSet, setSolvedSet] = useState(new Set())

  const puzzle = PUZZLES[puzzleIdx]

  async function handleCellClick(i) {
    if (result) return
    if (puzzle.board[i] !== null) return
    setChecking(true)
    try {
      const res = await api.ai.move(puzzle.board, 'hard', puzzle.toPlay, 'minimax', null, false)
      const isCorrect = res.move === i
      setResult(isCorrect ? 'correct' : 'wrong')
      setBestMove(res.move)
      if (isCorrect) setSolvedSet(prev => new Set([...prev, puzzle.id]))
    } catch {
      setResult('wrong')
    } finally {
      setChecking(false)
    }
  }

  function nextPuzzle() {
    setResult(null)
    setBestMove(null)
    setPuzzleIdx(i => (i + 1) % PUZZLES.length)
  }

  function prevPuzzle() {
    setResult(null)
    setBestMove(null)
    setPuzzleIdx(i => (i - 1 + PUZZLES.length) % PUZZLES.length)
  }

  function tryAgain() {
    setResult(null)
    setBestMove(null)
  }

  return (
    <div className="max-w-sm mx-auto space-y-6">
      {/* Header */}
      <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>Puzzles</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Find the best move in each position.
        </p>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          {puzzleIdx + 1} / {PUZZLES.length}
        </span>
        <div className="flex gap-1.5 flex-wrap">
          {PUZZLES.map((p, i) => (
            <button
              key={p.id}
              onClick={() => { setPuzzleIdx(i); setResult(null); setBestMove(null) }}
              className="w-5 h-5 rounded transition-colors"
              style={{
                backgroundColor: i === puzzleIdx
                  ? 'var(--color-blue-600)'
                  : solvedSet.has(p.id)
                    ? 'var(--color-teal-500)'
                    : 'var(--color-gray-200)',
              }}
            />
          ))}
        </div>
        <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
          {solvedSet.size} / {PUZZLES.length} solved
        </span>
      </div>

      {/* Puzzle card */}
      <div
        className="rounded-xl border-2 p-5 space-y-4"
        style={{
          borderColor: result === 'correct' ? 'var(--color-teal-500)' : result === 'wrong' ? 'var(--color-red-500)' : 'var(--border-default)',
          backgroundColor: 'var(--bg-surface)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div>
          <div className="font-bold text-lg" style={{ fontFamily: 'var(--font-display)' }}>{puzzle.title}</div>
          <div className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{puzzle.description}</div>
          <div className="mt-1.5 text-xs font-semibold px-2 py-0.5 rounded-full inline-block"
            style={{ backgroundColor: puzzle.toPlay === 'X' ? 'var(--color-blue-50)' : 'var(--color-teal-50)',
                     color: MARK_COLOR[puzzle.toPlay] }}>
            {puzzle.toPlay} to play
          </div>
        </div>

        {/* Board */}
        <div className={`grid grid-cols-3 gap-2 ${checking ? 'opacity-60' : ''}`}>
          {puzzle.board.map((cell, i) => {
            const isBest = result && bestMove === i
            const isEmpty = cell === null
            const isClickable = isEmpty && !result && !checking

            return (
              <button
                key={i}
                onClick={() => handleCellClick(i)}
                disabled={!isClickable}
                className={`
                  aspect-square flex items-center justify-center rounded-xl text-4xl font-bold
                  border-2 transition-all select-none
                  ${isBest && result === 'correct' ? 'bg-[var(--color-teal-50)] border-[var(--color-teal-500)]' : ''}
                  ${isBest && result === 'wrong' ? 'bg-[var(--color-teal-50)] border-[var(--color-teal-500)]' : ''}
                  ${!isBest ? 'bg-[var(--bg-surface)] border-[var(--border-default)]' : ''}
                  ${isClickable ? 'hover:bg-[var(--bg-surface-hover)] hover:scale-[1.04] cursor-pointer' : 'cursor-default'}
                `}
                style={{
                  minHeight: 72,
                  fontFamily: 'var(--font-display)',
                  color: cell ? MARK_COLOR[cell] : 'transparent',
                }}
              >
                {cell || '·'}
              </button>
            )
          })}
        </div>

        {/* Result feedback */}
        {result === 'correct' && (
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--color-teal-600)' }}>
            <span>✓</span> Correct! That's the best move.
          </div>
        )}
        {result === 'wrong' && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--color-red-600)' }}>
              <span>✗</span> Not quite. The best move is highlighted.
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {result === 'wrong' && (
            <button
              onClick={tryAgain}
              className="flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors hover:bg-[var(--bg-surface-hover)]"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
            >
              Try again
            </button>
          )}
          {result && (
            <button
              onClick={nextPuzzle}
              className="flex-1 py-2 rounded-lg text-sm font-medium text-white transition-all hover:brightness-110"
              style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
            >
              Next puzzle
            </button>
          )}
        </div>
      </div>

      {/* Prev / Next navigation */}
      <div className="flex gap-3">
        <button
          onClick={prevPuzzle}
          className="flex-1 py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-[var(--bg-surface-hover)]"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
        >
          ← Previous
        </button>
        <button
          onClick={nextPuzzle}
          className="flex-1 py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-[var(--bg-surface-hover)]"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
        >
          Next →
        </button>
      </div>
    </div>
  )
}
