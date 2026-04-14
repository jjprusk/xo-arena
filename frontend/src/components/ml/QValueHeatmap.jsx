// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'

/**
 * 3×3 Q-value heatmap.
 *
 * Props:
 *   board      — 9-element array ('X' | 'O' | null)
 *   qValues    — 9-element array of numbers | null (null = occupied cell)
 *   highlight  — optional cell index to outline as the chosen move
 *   onCellClick — optional (index) => void for interactive use
 */
export default function QValueHeatmap({ board, qValues, highlight, onCellClick }) {
  const legal = qValues?.filter(v => v !== null) ?? []
  const min = legal.length > 0 ? Math.min(...legal) : 0
  const max = legal.length > 0 ? Math.max(...legal) : 1
  const range = max - min || 1

  function cellColor(index) {
    const v = qValues?.[index]
    if (v === null || v === undefined) return 'var(--color-gray-100)'
    // Normalise 0–1 then map to red→yellow→green
    const t = (v - min) / range
    if (t < 0.5) {
      // red → yellow
      const r = 220
      const g = Math.round(t * 2 * 200)
      return `rgb(${r},${g},40)`
    }
    // yellow → green
    const r = Math.round((1 - (t - 0.5) * 2) * 200)
    const g = 190
    return `rgb(${r},${g},40)`
  }

  function label(index) {
    const v = qValues?.[index]
    if (v === null || v === undefined) return board?.[index] ?? ''
    return v.toFixed(3)
  }

  return (
    <div className="grid grid-cols-3 gap-1.5 w-full max-w-[220px]" aria-label="Q-value heatmap">
      {Array.from({ length: 9 }).map((_, i) => {
        const occupied = board?.[i] !== null && board?.[i] !== undefined
        const isHighlight = highlight === i
        return (
          <button
            key={i}
            type="button"
            onClick={() => onCellClick?.(i)}
            disabled={!onCellClick}
            className="aspect-square flex flex-col items-center justify-center rounded-lg border-2 transition-all"
            style={{
              backgroundColor: occupied ? 'var(--color-gray-100)' : cellColor(i),
              borderColor: isHighlight ? 'var(--color-blue-600)' : 'transparent',
              cursor: onCellClick ? 'pointer' : 'default',
              minHeight: 56,
            }}
          >
            {occupied ? (
              <span className="text-lg font-bold" style={{ color: board[i] === 'X' ? 'var(--color-blue-600)' : 'var(--color-teal-600)' }}>
                {board[i]}
              </span>
            ) : (
              <span className="text-[10px] font-mono font-semibold text-white drop-shadow-sm leading-tight text-center px-0.5">
                {label(i)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
