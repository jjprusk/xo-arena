// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { ROWS, COLS, CELLS, MARKS } from './logic.js'

/**
 * Compact Connect Four board thumbnail rendered on the Tables list page
 * for ACTIVE C4 tables. Mirrors the shape of `packages/game-xo`'s
 * BoardPreview so the platform can render it without game-specific
 * knowledge (`<PreviewComponent previewState={table.previewState} />`).
 *
 * @param {{ previewState: unknown, size?: number }} props
 */
export default function BoardPreview({ previewState, size = 56 }) {
  const board   = previewState?.board   ?? Array(CELLS).fill(null)
  const winLine = previewState?.winLine ?? []

  return (
    <div
      data-testid="board-preview"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${COLS}, 1fr)`,
        gridTemplateRows:    `repeat(${ROWS}, 1fr)`,
        width: size,
        aspectRatio: `${COLS} / ${ROWS}`,
        gap: 1,
        background: '#1e3a8a', // blue-900 — match the live board frame
        borderRadius: 4,
        padding: 2,
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      {board.map((mark, i) => {
        const isWin = winLine.includes(i)
        // Row-major: walk cells in render order so CSS grid lays them out
        // row 0 → top, row 5 → bottom (matches the live board exactly).
        return (
          <span
            key={i}
            data-cell={i}
            data-mark={mark ?? ''}
            data-win={isWin ? '1' : '0'}
            style={{
              display: 'block',
              borderRadius: '50%',
              background: mark === MARKS.FIRST
                ? '#facc15' // yellow-400
                : mark === MARKS.SECOND
                  ? '#dc2626' // red-600
                  : '#0f172a', // slate-900 (empty pocket)
              boxShadow: isWin ? '0 0 0 1px #fcd34d' : 'none',
            }}
          />
        )
      })}
    </div>
  )
}
