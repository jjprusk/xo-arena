// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import {
  BoardPreview,
  MARKS, emptyBoard, drop, indexOf, getWinner,
} from '@callidity/game-connect-four'

const Y = MARKS.FIRST
const R = MARKS.SECOND

describe('C4 BoardPreview', () => {
  it('renders 42 pockets from an empty previewState', () => {
    const { container } = render(<BoardPreview previewState={{ board: emptyBoard() }} />)
    expect(container.querySelectorAll('[data-cell]').length).toBe(42)
    // Empty: no cell carries a non-empty data-mark.
    for (const node of container.querySelectorAll('[data-cell]')) {
      expect(node.getAttribute('data-mark')).toBe('')
    }
  })

  it('marks cells per the board contents', () => {
    let b = emptyBoard()
    b = drop(b, 3, Y).board
    b = drop(b, 4, R).board
    const { container } = render(<BoardPreview previewState={{ board: b }} size={56} />)
    expect(
      container.querySelector(`[data-cell="${indexOf(5, 3)}"]`).getAttribute('data-mark')
    ).toBe(Y)
    expect(
      container.querySelector(`[data-cell="${indexOf(5, 4)}"]`).getAttribute('data-mark')
    ).toBe(R)
  })

  it('marks the four winning cells with data-win="1"', () => {
    let b = emptyBoard()
    for (const col of [0, 1, 2, 3]) b = drop(b, col, Y).board
    const w = getWinner(b)
    const { container } = render(<BoardPreview previewState={{ board: b, winLine: w.line }} />)
    for (const idx of w.line) {
      expect(container.querySelector(`[data-cell="${idx}"]`).getAttribute('data-win')).toBe('1')
    }
  })

  it('falls back to an empty board when previewState is missing', () => {
    const { container } = render(<BoardPreview />)
    expect(container.querySelectorAll('[data-cell]').length).toBe(42)
  })
})
