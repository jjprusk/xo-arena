// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect } from 'vitest'
import {
  ROWS, COLS, CELLS, WIN_RUN, MARKS, WIN_LINES,
  indexOf, coordsOf, emptyBoard, opponent,
  lowestEmptyRow, getLegalMoves, drop,
  getWinner, isBoardFull, gameStatus,
} from '../logic.js'

const Y = MARKS.FIRST  // 'Y'
const R = MARKS.SECOND // 'R'

/** Build a board from a 6-row ASCII picture. Row 0 = top, row 5 = bottom.
 *  Use 'Y', 'R', or '.' per cell. Whitespace and pipes are ignored.
 *  Example:
 *    pic(`
 *      .......
 *      .......
 *      .......
 *      .......
 *      ...Y...
 *      ..YR...
 *    `)
 */
function pic(text) {
  const cells = text.replace(/[^YR.]/g, '')
  if (cells.length !== CELLS) {
    throw new Error(`pic: expected ${CELLS} cells, got ${cells.length}`)
  }
  return cells.split('').map(c => c === '.' ? null : c)
}

describe('logic — geometry constants and helpers', () => {
  it('declares 6 rows × 7 columns = 42 cells', () => {
    expect(ROWS).toBe(6)
    expect(COLS).toBe(7)
    expect(CELLS).toBe(42)
    expect(WIN_RUN).toBe(4)
  })

  it('indexOf and coordsOf round-trip across the whole board', () => {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = indexOf(r, c)
        expect(i).toBeGreaterThanOrEqual(0)
        expect(i).toBeLessThan(CELLS)
        expect(coordsOf(i)).toEqual({ row: r, col: c })
      }
    }
  })

  it('opponent flips Y ↔ R and throws on unknown', () => {
    expect(opponent(Y)).toBe(R)
    expect(opponent(R)).toBe(Y)
    expect(() => opponent('X')).toThrow()
    expect(() => opponent(null)).toThrow()
  })

  it('emptyBoard is length 42 of null', () => {
    const b = emptyBoard()
    expect(b.length).toBe(CELLS)
    expect(b.every(c => c === null)).toBe(true)
  })
})

describe('logic — WIN_LINES enumeration', () => {
  it('contains exactly 69 lines with the documented breakdown (24+21+12+12)', () => {
    expect(WIN_LINES.length).toBe(69)
    let horiz = 0, vert = 0, diagDR = 0, diagDL = 0
    for (const line of WIN_LINES) {
      const coords = line.map(coordsOf)
      const allSameRow = coords.every(c => c.row === coords[0].row)
      const allSameCol = coords.every(c => c.col === coords[0].col)
      if (allSameRow) horiz++
      else if (allSameCol) vert++
      else {
        const rowStep = coords[1].row - coords[0].row
        const colStep = coords[1].col - coords[0].col
        if (rowStep === 1 && colStep === 1)  diagDR++
        if (rowStep === 1 && colStep === -1) diagDL++
      }
    }
    expect(horiz).toBe(24)
    expect(vert).toBe(21)
    expect(diagDR).toBe(12)
    expect(diagDL).toBe(12)
  })

  it('every line is 4 contiguous cells in one direction', () => {
    for (const line of WIN_LINES) {
      expect(line.length).toBe(4)
      const coords = line.map(coordsOf)
      const dr = coords[1].row - coords[0].row
      const dc = coords[1].col - coords[0].col
      for (let i = 1; i < 4; i++) {
        expect(coords[i].row - coords[i - 1].row).toBe(dr)
        expect(coords[i].col - coords[i - 1].col).toBe(dc)
      }
    }
  })
})

describe('logic — drop and gravity', () => {
  it('drops into bottom row of an empty column', () => {
    const b = emptyBoard()
    const r = drop(b, 3, Y)
    expect(r).not.toBeNull()
    expect(r.row).toBe(ROWS - 1)
    expect(r.index).toBe(indexOf(ROWS - 1, 3))
    expect(r.board[r.index]).toBe(Y)
    // Original board not mutated.
    expect(b.every(c => c === null)).toBe(true)
  })

  it('stacks on top of existing pieces', () => {
    let b = emptyBoard()
    b = drop(b, 0, Y).board
    b = drop(b, 0, R).board
    b = drop(b, 0, Y).board
    expect(b[indexOf(5, 0)]).toBe(Y) // bottom
    expect(b[indexOf(4, 0)]).toBe(R)
    expect(b[indexOf(3, 0)]).toBe(Y)
    expect(b[indexOf(2, 0)]).toBe(null) // empty above
  })

  it('returns null when column is full', () => {
    let b = emptyBoard()
    for (let i = 0; i < ROWS; i++) b = drop(b, 2, i % 2 ? R : Y).board
    expect(drop(b, 2, Y)).toBeNull()
  })

  it('returns null for out-of-bounds columns', () => {
    const b = emptyBoard()
    expect(drop(b, -1, Y)).toBeNull()
    expect(drop(b, COLS, Y)).toBeNull()
    expect(drop(b, 999, Y)).toBeNull()
  })

  it('returns null for invalid marks', () => {
    const b = emptyBoard()
    expect(drop(b, 0, 'X')).toBeNull()
    expect(drop(b, 0, null)).toBeNull()
    expect(drop(b, 0, '')).toBeNull()
  })

  it('lowestEmptyRow returns -1 for full columns and out-of-bounds', () => {
    const b = emptyBoard()
    expect(lowestEmptyRow(b, 0)).toBe(ROWS - 1)
    expect(lowestEmptyRow(b, -1)).toBe(-1)
    expect(lowestEmptyRow(b, COLS)).toBe(-1)
    let b2 = b
    for (let i = 0; i < ROWS; i++) b2 = drop(b2, 0, i % 2 ? R : Y).board
    expect(lowestEmptyRow(b2, 0)).toBe(-1)
  })
})

describe('logic — legal moves', () => {
  it('returns all 7 columns for an empty board, in column order', () => {
    expect(getLegalMoves(emptyBoard())).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('excludes columns whose top row is filled', () => {
    let b = emptyBoard()
    for (let i = 0; i < ROWS; i++) b = drop(b, 3, i % 2 ? R : Y).board
    expect(getLegalMoves(b)).toEqual([0, 1, 2, 4, 5, 6])
  })

  it('returns empty array when every column is full', () => {
    let b = emptyBoard()
    for (let c = 0; c < COLS; c++) {
      for (let i = 0; i < ROWS; i++) b = drop(b, c, i % 2 ? R : Y).board
    }
    expect(getLegalMoves(b)).toEqual([])
  })
})

describe('logic — win detection (all four directions)', () => {
  it('detects horizontal win', () => {
    const b = pic(`
      .......
      .......
      .......
      .......
      .......
      .YYYY..
    `)
    const w = getWinner(b)
    expect(w?.mark).toBe(Y)
    expect(w?.line.length).toBe(4)
    // Win is bottom row cells 1-4.
    expect(w.line).toEqual([indexOf(5, 1), indexOf(5, 2), indexOf(5, 3), indexOf(5, 4)])
  })

  it('detects vertical win', () => {
    const b = pic(`
      .......
      .......
      ...R...
      ...R...
      ...R...
      ...R...
    `)
    const w = getWinner(b)
    expect(w?.mark).toBe(R)
    expect(w.line).toEqual([indexOf(2, 3), indexOf(3, 3), indexOf(4, 3), indexOf(5, 3)])
  })

  it('detects down-right (↘) diagonal win', () => {
    const b = pic(`
      .......
      ..Y....
      ...Y...
      ....Y..
      .....Y.
      .......
    `)
    const w = getWinner(b)
    expect(w?.mark).toBe(Y)
    expect(w.line).toEqual([indexOf(1, 2), indexOf(2, 3), indexOf(3, 4), indexOf(4, 5)])
  })

  it('detects down-left (↙) diagonal win', () => {
    const b = pic(`
      .......
      .....R.
      ....R..
      ...R...
      ..R....
      .......
    `)
    const w = getWinner(b)
    expect(w?.mark).toBe(R)
    expect(w.line).toEqual([indexOf(1, 5), indexOf(2, 4), indexOf(3, 3), indexOf(4, 2)])
  })

  it('returns null when no four-in-a-row exists', () => {
    const b = pic(`
      .......
      .......
      .......
      .......
      .YR.YR.
      Y.RYRY.
    `)
    expect(getWinner(b)).toBeNull()
  })

  it('does not count three-in-a-row as a win', () => {
    const b = pic(`
      .......
      .......
      .......
      .......
      .......
      .YYY...
    `)
    expect(getWinner(b)).toBeNull()
  })

  it('finds a win even when other lines are dirty', () => {
    const b = pic(`
      .......
      .......
      Y......
      Y.R....
      Y.R.Y..
      YRRRYR.
    `)
    // Column 0 has Y stacked at rows 2-5 = 4 vertical Y.
    const w = getWinner(b)
    expect(w?.mark).toBe(Y)
    expect(w.line).toEqual([indexOf(2, 0), indexOf(3, 0), indexOf(4, 0), indexOf(5, 0)])
  })
})

describe('logic — draw detection', () => {
  it('isBoardFull is false for empty and partial boards', () => {
    expect(isBoardFull(emptyBoard())).toBe(false)
    const partial = pic(`
      .......
      .......
      .......
      .......
      .......
      YRYRYRY
    `)
    expect(isBoardFull(partial)).toBe(false)
  })

  it('isBoardFull is true when every cell is filled', () => {
    // Alternating fill that contains no 4-in-a-row.
    const full = pic(`
      YRYRYRY
      YRYRYRY
      RYRYRYR
      RYRYRYR
      YRYRYRY
      YRYRYRY
    `)
    expect(isBoardFull(full)).toBe(true)
  })
})

describe('logic — gameStatus terminal classification', () => {
  it('in_progress for a mid-game position', () => {
    const b = pic(`
      .......
      .......
      .......
      .......
      ...Y...
      ..YRR..
    `)
    expect(gameStatus(b)).toEqual({ status: 'in_progress' })
  })

  it('win returns mark + line', () => {
    const b = pic(`
      .......
      .......
      .......
      .......
      .......
      YYYY...
    `)
    const s = gameStatus(b)
    expect(s.status).toBe('win')
    expect(s.mark).toBe(Y)
    expect(s.line.length).toBe(4)
  })

  it('draw when board full with no winner', () => {
    // Constructing a full board with zero 4-in-a-rows is fiddly because the
    // obvious checkerboard pattern produces a 4-on-diagonal (parity trap:
    // diagonal cells share (r+c) parity). The pattern below uses a
    // (2r + c) mod 4 → YYRR → 2-then-2 stripe that breaks both the
    // horizontal/vertical alternation AND the diagonal parity, yielding
    // no 4-in-a-row in any direction.
    const b = pic(`
      YYRRYYR
      RRYYRRY
      YYRRYYR
      RRYYRRY
      YYRRYYR
      RRYYRRY
    `)
    expect(isBoardFull(b)).toBe(true)
    expect(getWinner(b)).toBeNull()
    expect(gameStatus(b)).toEqual({ status: 'draw' })
  })
})

describe('logic — example complete game', () => {
  it('plays a short vertical win for Y in column 3', () => {
    let b = emptyBoard()
    let turn = Y
    const moves = [3, 0, 3, 1, 3, 2, 3] // Y wins on the 7th move (4 in column 3)
    for (const col of moves) {
      const r = drop(b, col, turn)
      expect(r).not.toBeNull()
      b = r.board
      turn = opponent(turn)
    }
    const s = gameStatus(b)
    expect(s.status).toBe('win')
    expect(s.mark).toBe(Y)
  })
})
