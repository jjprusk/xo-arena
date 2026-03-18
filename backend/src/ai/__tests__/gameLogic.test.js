import { describe, it, expect } from 'vitest'
import { getWinner, isBoardFull, getEmptyCells, opponent } from '../gameLogic.js'

describe('getWinner', () => {
  it('returns X when X wins top row', () => {
    expect(getWinner(['X', 'X', 'X', null, null, null, null, null, null])).toBe('X')
  })

  it('returns O when O wins left column', () => {
    expect(getWinner(['O', null, null, 'O', null, null, 'O', null, null])).toBe('O')
  })

  it('returns X on diagonal', () => {
    expect(getWinner(['X', null, null, null, 'X', null, null, null, 'X'])).toBe('X')
  })

  it('returns null when no winner', () => {
    expect(getWinner(['X', 'O', 'X', 'O', 'X', 'O', 'O', 'X', 'O'])).toBe(null)
  })

  it('returns null on empty board', () => {
    expect(getWinner(Array(9).fill(null))).toBe(null)
  })
})

describe('isBoardFull', () => {
  it('returns true when all cells filled', () => {
    expect(isBoardFull(['X', 'O', 'X', 'O', 'X', 'O', 'O', 'X', 'O'])).toBe(true)
  })

  it('returns false when cells remain', () => {
    expect(isBoardFull(['X', null, 'X', 'O', 'X', 'O', 'O', 'X', 'O'])).toBe(false)
  })
})

describe('getEmptyCells', () => {
  it('returns all indices on empty board', () => {
    expect(getEmptyCells(Array(9).fill(null))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('returns only empty cell indices', () => {
    const board = ['X', null, 'O', null, null, 'X', null, null, null]
    expect(getEmptyCells(board)).toEqual([1, 3, 4, 6, 7, 8])
  })

  it('returns empty array on full board', () => {
    expect(getEmptyCells(['X', 'O', 'X', 'O', 'X', 'O', 'O', 'X', 'O'])).toEqual([])
  })
})

describe('opponent', () => {
  it('returns O for X', () => expect(opponent('X')).toBe('O'))
  it('returns X for O', () => expect(opponent('O')).toBe('X'))
})
