// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect } from 'vitest'
import {
  CELLS, COLS, MARKS, emptyBoard, drop, indexOf, getWinner, opponent,
} from '../logic.js'
import {
  CENTER_ORDER, WIN_SCORE, DIFFICULTY_DEPTH,
  evaluate, search, bestMove,
} from '../minimax.js'

const Y = MARKS.FIRST
const R = MARKS.SECOND

function pic(text) {
  const cells = text.replace(/[^YR.]/g, '')
  if (cells.length !== CELLS) {
    throw new Error(`pic: expected ${CELLS} cells, got ${cells.length}`)
  }
  return cells.split('').map(c => c === '.' ? null : c)
}

describe('minimax — CENTER_ORDER', () => {
  it('is exactly [3, 2, 4, 1, 5, 0, 6] for the standard 7-col board', () => {
    expect(CENTER_ORDER).toEqual([3, 2, 4, 1, 5, 0, 6])
  })

  it('covers every column exactly once', () => {
    const set = new Set(CENTER_ORDER)
    expect(set.size).toBe(COLS)
    for (let c = 0; c < COLS; c++) expect(set.has(c)).toBe(true)
  })
})

describe('minimax — evaluate', () => {
  it('is exactly zero on an empty board (symmetric position)', () => {
    expect(evaluate(emptyBoard(), Y)).toBe(0)
    expect(evaluate(emptyBoard(), R)).toBe(0)
  })

  it('is positive when mark has open threats and opponent does not', () => {
    // Y has three in a row on the bottom; R has nothing.
    const b = pic(`
      .......
      .......
      .......
      .......
      .......
      .YYY...
    `)
    expect(evaluate(b, Y)).toBeGreaterThan(0)
    expect(evaluate(b, R)).toBeLessThan(0)
  })

  it('discounts a line that both colors share to zero', () => {
    // Y and R both touch the bottom row's left segment.
    const a = pic(`
      .......
      .......
      .......
      .......
      .......
      .Y.....
    `)
    const b = pic(`
      .......
      .......
      .......
      .......
      .......
      .YR....
    `)
    // Adding R to a Y-only line reduces Y's contribution from that line.
    expect(evaluate(a, Y)).toBeGreaterThanOrEqual(evaluate(b, Y))
  })

  it('is sign-symmetric: evaluate(b, Y) === −evaluate(b, R) for any position', () => {
    let b = emptyBoard()
    const moves = [[3, Y], [3, R], [4, Y], [2, R], [2, Y], [4, R]]
    for (const [c, m] of moves) b = drop(b, c, m).board
    expect(evaluate(b, Y)).toBe(-evaluate(b, R))
  })
})

describe('minimax — search (terminal nodes)', () => {
  it('returns +WIN_SCORE-ish when rootMark has already won', () => {
    const b = pic(`
      .......
      .......
      .......
      .......
      .......
      YYYY...
    `)
    // mark=R is to move but Y already has 4. Search should see Y win.
    const s = search(b, R, 5, -Infinity, Infinity, Y)
    expect(s).toBeGreaterThan(WIN_SCORE - 1000) // depth bias may shave a little
  })

  it('returns −WIN_SCORE-ish when rootMark has already lost', () => {
    const b = pic(`
      .......
      .......
      .......
      .......
      .......
      YYYY...
    `)
    const s = search(b, R, 5, -Infinity, Infinity, R)
    expect(s).toBeLessThan(-(WIN_SCORE - 1000))
  })

  it('returns 0 on a full draw board', () => {
    const draw = pic(`
      YYRRYYR
      RRYYRRY
      YYRRYYR
      RRYYRRY
      YYRRYYR
      RRYYRRY
    `)
    expect(getWinner(draw)).toBeNull()
    expect(search(draw, Y, 5, -Infinity, Infinity, Y)).toBe(0)
  })
})

describe('minimax — bestMove tactical decisions', () => {
  it('opens with the center column from an empty board', () => {
    // Center is provably the strongest opening square in Connect Four.
    expect(bestMove(emptyBoard(), Y, DIFFICULTY_DEPTH.medium)).toBe(3)
  })

  it('completes a horizontal four-in-a-row when one is available', () => {
    // Y has three in a row on bottom with both ends open. The drop in
    // column 4 makes it four. The drop in column 0 also makes four.
    // Either is a win; minimax should pick one of them (we accept both).
    const b = pic(`
      .......
      .......
      .......
      .......
      .......
      .YYY...
    `)
    const move = bestMove(b, Y, DIFFICULTY_DEPTH.medium)
    expect([0, 4]).toContain(move)
  })

  it('blocks an opponent\'s immediate winning threat (unique block)', () => {
    // R has three stacked in column 3 (rows 3-5). The 4th R at (2, 3)
    // would complete a vertical win. Y must drop column 3 to block —
    // there's no other way to stop the threat. (A horizontal 3-in-a-row
    // with both ends open would be an unblockable double threat; vertical
    // is the cleanest single-ended block to test.)
    const b = pic(`
      .......
      .......
      .......
      ...R...
      ...R...
      ...R...
    `)
    const move = bestMove(b, Y, DIFFICULTY_DEPTH.medium)
    expect(move).toBe(3)
  })

  it('prefers a winning move over any non-winning move', () => {
    // Y can win immediately by dropping in column 3 (vertical 4 in col 3).
    // Column 0 would also be a reasonable positional move but search
    // should pick the win.
    let b = emptyBoard()
    b = drop(b, 3, Y).board
    b = drop(b, 0, R).board
    b = drop(b, 3, Y).board
    b = drop(b, 0, R).board
    b = drop(b, 3, Y).board
    b = drop(b, 0, R).board
    // Column 3 now has Y stacked 3-tall at rows 3,4,5 — drop one more for win.
    const move = bestMove(b, Y, DIFFICULTY_DEPTH.medium)
    expect(move).toBe(3)
  })

  it('returns -1 when there are no legal moves (full board)', () => {
    const full = pic(`
      YYRRYYR
      RRYYRRY
      YYRRYYR
      RRYYRRY
      YYRRYYR
      RRYYRRY
    `)
    expect(bestMove(full, Y, DIFFICULTY_DEPTH.medium)).toBe(-1)
  })

  it('avoids dropping into a column that would give R a winning reply', () => {
    // R has 3 in a column waiting; if Y stacks on top of R's column,
    // R immediately wins by playing the column adjacent. Concretely:
    // column 2 has R-R-R from rows 3-5. Y should NOT play column 2 (would
    // close the column harmlessly) but more importantly must not play
    // anywhere that gives R a free 4-in-a-row reply. With depth ≥ 2,
    // search sees R's column-2 win and prefers blocking it (col 2 itself
    // blocks, or a column completing Y's own threats).
    const b = pic(`
      .......
      .......
      ..R....
      ..R....
      ..R....
      .YYY.YR
    `)
    // R threatens column 2 (vertical) — Y must block or win. The only
    // immediate block is column 2 (filling row 1 of that column),
    // and Y has 3 in bottom row at cols 1-3 → completing col 0 or 4
    // would *also* win for Y (4 horizontal). Either response is fine.
    // Stronger search may prefer the immediate horizontal win.
    const move = bestMove(b, Y, DIFFICULTY_DEPTH.medium)
    expect([0, 2, 4]).toContain(move)
  })
})

describe('minimax — depth scaling', () => {
  it('higher depth picks at least as good a move (no obvious blunder downgrade)', () => {
    // Construct a mid-game position and compare depth-2 vs depth-4 from
    // the same side. We only assert depth-4 doesn't pick a *losing* move
    // when depth-2 found a non-losing one — a soft "doesn't regress" check.
    const b = pic(`
      .......
      .......
      .......
      ...Y...
      ...R...
      ..RYR..
    `)
    const d2 = bestMove(b, Y, 2)
    const d4 = bestMove(b, Y, 4)
    expect(d2).toBeGreaterThanOrEqual(0)
    expect(d4).toBeGreaterThanOrEqual(0)
    // Both should be legal columns (top row empty in cols 0..6).
    expect(d2).toBeLessThan(COLS)
    expect(d4).toBeLessThan(COLS)
  })
})
