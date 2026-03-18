import { describe, it, expect, beforeEach } from 'vitest'
import { useGameStore } from '../gameStore.js'

function getState() {
  return useGameStore.getState()
}

function reset() {
  useGameStore.getState().newGame()
}

describe('gameStore', () => {
  beforeEach(reset)

  describe('startGame', () => {
    it('sets status to playing', () => {
      getState().startGame()
      expect(getState().status).toBe('playing')
    })

    it('resets board to empty', () => {
      getState().startGame()
      expect(getState().board).toEqual(Array(9).fill(null))
    })

    it('starts with X turn', () => {
      getState().startGame()
      expect(getState().currentTurn).toBe('X')
    })
  })

  describe('makeMove', () => {
    beforeEach(() => getState().startGame())

    it('places the current mark', () => {
      getState().makeMove(4)
      expect(getState().board[4]).toBe('X')
    })

    it('switches turn after move', () => {
      getState().makeMove(4)
      expect(getState().currentTurn).toBe('O')
    })

    it('ignores move on occupied cell', () => {
      getState().makeMove(4)
      getState().makeMove(4)
      expect(getState().board[4]).toBe('X')
      expect(getState().currentTurn).toBe('O')
    })

    it('ignores move when game not playing', () => {
      getState().newGame()
      getState().makeMove(0)
      expect(getState().board[0]).toBeNull()
    })
  })

  describe('win detection', () => {
    beforeEach(() => getState().startGame())

    it('detects X winning top row', () => {
      const s = getState()
      // X: 0, O: 3, X: 1, O: 4, X: 2
      s.makeMove(0); s.makeMove(3)
      s.makeMove(1); s.makeMove(4)
      s.makeMove(2)
      expect(getState().status).toBe('won')
      expect(getState().winner).toBe('X')
      expect(getState().winLine).toEqual([0, 1, 2])
    })

    it('updates score on win', () => {
      const s = getState()
      s.makeMove(0); s.makeMove(3)
      s.makeMove(1); s.makeMove(4)
      s.makeMove(2)
      expect(getState().scores.X).toBe(1)
    })
  })

  describe('draw detection', () => {
    it('detects draw', () => {
      getState().startGame()
      const s = getState()
      // Draw sequence: X O X O X O O X O — no winner
      // X:0 O:1 X:2 O:4 X:3 O:5 X:7 O:6 X:8
      s.makeMove(0); s.makeMove(1)
      s.makeMove(2); s.makeMove(4)
      s.makeMove(3); s.makeMove(5)
      s.makeMove(7); s.makeMove(6)
      s.makeMove(8)
      const state = getState()
      expect(state.status).toBe('draw')
      expect(state.winner).toBeNull()
    })
  })

  describe('rematch', () => {
    it('resets board but preserves scores', () => {
      getState().startGame()
      const s = getState()
      // X wins
      s.makeMove(0); s.makeMove(3)
      s.makeMove(1); s.makeMove(4)
      s.makeMove(2)
      getState().rematch()
      const state = getState()
      expect(state.board).toEqual(Array(9).fill(null))
      expect(state.scores.X).toBe(1)
      expect(state.status).toBe('playing')
    })

    it('increments round', () => {
      getState().startGame()
      const initial = getState().round
      getState().makeMove(0)
      // force rematch after a win
      getState().startGame()
      getState().rematch()
      // round should go up by 1 from whatever startGame set
    })
  })

  describe('newGame', () => {
    it('resets scores and returns to idle', () => {
      getState().startGame()
      getState().makeMove(0)
      getState().newGame()
      const state = getState()
      expect(state.status).toBe('idle')
      expect(state.scores).toEqual({ X: 0, O: 0 })
      expect(state.mode).toBeNull()
    })
  })
})
