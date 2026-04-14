// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Puzzle Mode — tactical tic-tac-toe puzzles.
 * Puzzles are generated server-side by type: win1, block1, fork, survive.
 */

import React, { useState, useEffect } from 'react'
import { api } from '../lib/api.js'

const MARK_COLOR = {
  X: 'var(--color-blue-600)',
  O: 'var(--color-teal-600)',
}

const TYPE_META = {
  win1:    { label: 'Win in 1',    color: 'var(--color-teal-600)',  bg: 'var(--color-teal-50)' },
  block1:  { label: 'Block',       color: 'var(--color-blue-600)',  bg: 'var(--color-blue-50)' },
  fork:    { label: 'Fork',        color: 'var(--color-amber-600)', bg: 'var(--color-amber-50)' },
  survive: { label: 'Draw or Die', color: 'var(--color-red-600)',   bg: 'var(--color-red-50)' },
}

const ALL_TYPES = Object.keys(TYPE_META)

export default function PuzzlePage() {
  const [activeType, setActiveType] = useState(null) // null = all
  const [puzzles, setPuzzles] = useState([])
  const [idx, setIdx] = useState(0)
  const [result, setResult] = useState(null)      // null | 'correct' | 'wrong'
  const [selectedCell, setSelectedCell] = useState(null)
  const [solvedIds, setSolvedIds] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function loadPuzzles(type) {
    setLoading(true)
    setError(null)
    setResult(null)
    setSelectedCell(null)
    setIdx(0)
    try {
      const { puzzles: loaded } = await api.puzzles.list(type, 8)
      setPuzzles(loaded)
      setSolvedIds(new Set())
    } catch {
      setError('Failed to load puzzles.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadPuzzles(activeType) }, [activeType])

  function handleTypeFilter(type) {
    setActiveType(type === activeType ? null : type)
  }

  function handleCellClick(i) {
    if (result || !puzzle) return
    if (puzzle.board[i] !== null) return

    const isCorrect = puzzle.solutions.includes(i)
    setSelectedCell(i)
    setResult(isCorrect ? 'correct' : 'wrong')
    if (isCorrect) setSolvedIds(prev => new Set([...prev, puzzle.id]))
  }

  function goTo(newIdx) {
    setResult(null)
    setSelectedCell(null)
    setIdx(newIdx)
  }

  function tryAgain() {
    setResult(null)
    setSelectedCell(null)
  }

  const puzzle = puzzles[idx] ?? null

  return (
    <div className="max-w-sm mx-auto space-y-5">
      {/* Header */}
      <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>Puzzles</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Find the best move in each position.
        </p>
      </div>

      {/* Type filter */}
      <div className="flex gap-1.5 flex-wrap">
        {ALL_TYPES.map(t => {
          const meta = TYPE_META[t]
          const active = activeType === t
          return (
            <button
              key={t}
              onClick={() => handleTypeFilter(t)}
              className="px-3 py-1 rounded-full text-xs font-semibold border transition-colors"
              style={{
                borderColor: active ? meta.color : 'var(--border-default)',
                backgroundColor: active ? meta.bg : 'transparent',
                color: active ? meta.color : 'var(--text-secondary)',
              }}
            >
              {meta.label}
            </button>
          )
        })}
        {activeType && (
          <button
            onClick={() => setActiveType(null)}
            className="px-3 py-1 rounded-full text-xs font-semibold border transition-colors"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
          >
            All
          </button>
        )}
      </div>

      {/* Progress row */}
      {!loading && puzzles.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 flex-wrap">
            {puzzles.map((p, i) => (
              <button
                key={p.id}
                onClick={() => goTo(i)}
                title={p.title}
                className="w-4 h-4 rounded-sm transition-all"
                style={{
                  backgroundColor: i === idx
                    ? 'var(--color-blue-600)'
                    : solvedIds.has(p.id)
                      ? 'var(--color-teal-500)'
                      : 'var(--color-gray-200)',
                  transform: i === idx ? 'scale(1.25)' : undefined,
                }}
              />
            ))}
          </div>
          <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
            {solvedIds.size}/{puzzles.length} solved
          </span>
          <button
            onClick={() => loadPuzzles(activeType)}
            className="text-xs px-2 py-0.5 rounded border transition-colors hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
          >
            New set
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-sm text-center py-8" style={{ color: 'var(--color-red-600)' }}>
          {error}
          <button onClick={() => loadPuzzles(activeType)} className="block mx-auto mt-2 underline text-xs">
            Retry
          </button>
        </div>
      )}

      {/* Puzzle card */}
      {!loading && puzzle && (
        <div
          className="rounded-xl border-2 p-5 space-y-4"
          style={{
            borderColor: result === 'correct'
              ? 'var(--color-teal-500)'
              : result === 'wrong'
                ? 'var(--color-red-500)'
                : 'var(--border-default)',
            backgroundColor: 'var(--bg-surface)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {/* Title + type badge */}
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="font-bold text-lg" style={{ fontFamily: 'var(--font-display)' }}>
                {puzzle.title}
              </div>
              <TypeBadge type={puzzle.type} />
            </div>
            <div className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {puzzle.description}
            </div>
            <div
              className="mt-2 text-xs font-semibold px-2 py-0.5 rounded-full inline-block"
              style={{
                backgroundColor: puzzle.toPlay === 'X' ? 'var(--color-blue-50)' : 'var(--color-teal-50)',
                color: MARK_COLOR[puzzle.toPlay],
              }}
            >
              {puzzle.toPlay} to play
            </div>
          </div>

          {/* Board */}
          <div className="grid grid-cols-3 gap-2">
            {puzzle.board.map((cell, i) => {
              const isSolution = result && puzzle.solutions.includes(i)
              const isSelected = selectedCell === i
              const isEmpty = cell === null
              const isClickable = isEmpty && !result

              let borderColor = 'var(--border-default)'
              let bgColor = 'var(--bg-surface)'
              if (isSolution && result === 'correct') { borderColor = 'var(--color-teal-500)'; bgColor = 'var(--color-teal-50)' }
              if (isSolution && result === 'wrong') { borderColor = 'var(--color-teal-500)'; bgColor = 'var(--color-teal-50)' }
              if (isSelected && result === 'wrong' && !isSolution) { borderColor = 'var(--color-red-500)'; bgColor = 'var(--color-red-50)' }

              return (
                <button
                  key={i}
                  onClick={() => handleCellClick(i)}
                  disabled={!isClickable}
                  className={`aspect-square flex items-center justify-center rounded-xl text-4xl font-bold border-2 transition-all select-none ${isClickable ? 'hover:bg-[var(--bg-surface-hover)] hover:scale-[1.04] cursor-pointer' : 'cursor-default'}`}
                  style={{
                    minHeight: 'clamp(56px, 20vw, 72px)',
                    fontFamily: 'var(--font-display)',
                    color: cell ? MARK_COLOR[cell] : 'transparent',
                    borderColor,
                    backgroundColor: bgColor,
                  }}
                >
                  {cell || (isSolution && result === 'wrong' ? (
                    <span style={{ color: MARK_COLOR[puzzle.toPlay], opacity: 0.7, fontSize: '1.5rem' }}>
                      {puzzle.toPlay}
                    </span>
                  ) : '·')}
                </button>
              )
            })}
          </div>

          {/* Result feedback */}
          {result === 'correct' && (
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--color-teal-600)' }}>
              <span>✓</span>
              <span>Correct! {puzzle.type === 'fork' ? 'That creates a fork.' : puzzle.type === 'survive' ? 'That keeps you alive.' : 'That\'s the best move.'}</span>
            </div>
          )}
          {result === 'wrong' && (
            <div className="text-sm" style={{ color: 'var(--color-red-600)' }}>
              <span className="font-semibold">✗ Not quite.</span>
              {' '}
              <span style={{ color: 'var(--text-secondary)' }}>
                {puzzle.solutions.length === 1 ? 'The correct move is highlighted.' : `Any of the ${puzzle.solutions.length} highlighted cells would work.`}
              </span>
            </div>
          )}

          {/* Action buttons */}
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
                onClick={() => goTo((idx + 1) % puzzles.length)}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white transition-all hover:brightness-110"
                style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
              >
                Next puzzle
              </button>
            )}
          </div>
        </div>
      )}

      {/* Prev / Next navigation */}
      {!loading && puzzles.length > 1 && (
        <div className="flex gap-3">
          <button
            onClick={() => goTo((idx - 1 + puzzles.length) % puzzles.length)}
            className="flex-1 py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            ← Previous
          </button>
          <button
            onClick={() => goTo((idx + 1) % puzzles.length)}
            className="flex-1 py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

function TypeBadge({ type }) {
  const meta = TYPE_META[type]
  if (!meta) return null
  return (
    <span
      className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ backgroundColor: meta.bg, color: meta.color }}
    >
      {meta.label}
    </span>
  )
}
