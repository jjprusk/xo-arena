// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'

/**
 * Compact XO board thumbnail for the Tables list page.
 * Renders a 3×3 grid from previewState at a small fixed size.
 *
 * @param {{ previewState: unknown, size?: number }} props
 */
export default function BoardPreview({ previewState, size = 40 }) {
  const board   = previewState?.board   ?? Array(9).fill(null)
  const winLine = previewState?.winLine ?? []
  const cell    = size / 3

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        width: size,
        height: size,
        gap: 1.5,
        background: 'var(--border-default)',
        borderRadius: 4,
        overflow: 'hidden',
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      {board.map((mark, i) => {
        const isWin = winLine.includes(i)
        return (
          <div
            key={i}
            style={{
              background: isWin ? 'var(--color-amber-100)' : 'var(--bg-surface)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: Math.round(cell * 0.58),
              fontWeight: 700,
              lineHeight: 1,
              color: mark === 'X'
                ? (isWin ? 'var(--color-amber-600)' : 'var(--color-blue-600)')
                : mark === 'O'
                  ? (isWin ? 'var(--color-amber-600)' : 'var(--color-teal-600)')
                  : 'transparent',
            }}
          >
            {mark ?? '·'}
          </div>
        )
      })}
    </div>
  )
}
