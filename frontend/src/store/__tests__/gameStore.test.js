import { describe, it, expect, beforeEach } from 'vitest'
import { useGameStore } from '../gameStore.js'

function s() {
  return useGameStore.getState()
}

function reset() {
  s().newGame()
}

function startPlaying() {
  s().startGame()
}

// Win sequence helper: X wins top row (0,1,2); O plays 3,4
function playXWinsTopRow() {
  s().makeMove(0) // X
  s().makeMove(3) // O
  s().makeMove(1) // X
  s().makeMove(4) // O
  s().makeMove(2) // X wins [0,1,2]
}

// Draw sequence: fills board with no winner
// Board result:
//  X | O | X
//  X | O | O
//  O | X | X
function playDraw() {
  s().makeMove(0) // X
  s().makeMove(1) // O
  s().makeMove(2) // X
  s().makeMove(4) // O
  s().makeMove(3) // X
  s().makeMove(5) // O
  s().makeMove(7) // X
  s().makeMove(6) // O
  s().makeMove(8) // X — board full, no winner
}

describe('gameStore', () => {
  beforeEach(reset)

  // ── makeMove ─────────────────────────────────────────────────────────────

  describe('makeMove', () => {
    beforeEach(startPlaying)

    it('places mark on board at the correct index', () => {
      s().makeMove(4)
      expect(s().board[4]).toBe('X')
    })

    it('switches currentTurn from X to O after move', () => {
      s().makeMove(4)
      expect(s().currentTurn).toBe('O')
    })

    it('does nothing on an occupied cell', () => {
      s().makeMove(4) // X plays 4
      s().makeMove(4) // O tries same cell
      expect(s().board[4]).toBe('X')
      expect(s().currentTurn).toBe('O') // turn did NOT switch back
    })

    it('does nothing when status is not playing', () => {
      s().newGame() // status becomes 'idle'
      s().makeMove(0)
      expect(s().board[0]).toBeNull()
    })

    it('detects win — status becomes "won" and winner is set', () => {
      playXWinsTopRow()
      expect(s().status).toBe('won')
      expect(s().winner).toBe('X')
      expect(s().winLine).toEqual([0, 1, 2])
    })

    it('detects draw — status becomes "draw" and winner is null', () => {
      playDraw()
      expect(s().status).toBe('draw')
      expect(s().winner).toBeNull()
    })

    it('misere mode flips winner (player who completes a line loses)', () => {
      s().setMisereMode(true)
      s().startGame()
      // X completes top row, so in misere X *loses* → winner should be O
      playXWinsTopRow()
      expect(s().winner).toBe('O')
      s().setMisereMode(false) // clean up
    })

    it('increments score for the winner', () => {
      playXWinsTopRow()
      expect(s().scores.X).toBe(1)
      expect(s().scores.O).toBe(0)
    })

    it('sets seriesWinner when a player reaches bestOf target wins', () => {
      s().setBestOf(1) // first win ends the series
      s().startGame()
      playXWinsTopRow()
      expect(s().seriesWinner).toBe('X')
    })

    it('does not set seriesWinner before target is reached', () => {
      s().setBestOf(3)
      s().startGame()
      playXWinsTopRow()
      expect(s().seriesWinner).toBeNull()
    })
  })

  // ── undoMove ─────────────────────────────────────────────────────────────

  describe('undoMove', () => {
    it('reverts the last 2 moves in hva mode', () => {
      s().setMode('hva')
      s().startGame()
      s().makeMove(0) // X (human)
      s().makeMove(4) // O (AI)
      const boardBefore = [...s().board]
      s().makeMove(2) // X again
      s().makeMove(6) // O again
      s().undoMove()
      // Should revert to state before last 2 moves
      expect(s().board).toEqual(boardBefore)
    })

    it('undoes only 1 move when only 1 move has been made', () => {
      s().setMode('hva')
      s().startGame()
      s().makeMove(4) // X
      s().undoMove()
      expect(s().board).toEqual(Array(9).fill(null))
      expect(s().currentTurn).toBe('X')
    })

    it('does nothing when not in hva mode', () => {
      s().setMode('hvh')
      s().startGame()
      s().makeMove(0) // X
      s().makeMove(4) // O
      s().undoMove()
      // Board unchanged
      expect(s().board[0]).toBe('X')
      expect(s().board[4]).toBe('O')
    })

    it('does nothing when status is not playing', () => {
      s().setMode('hva')
      s().startGame()
      s().makeMove(0)
      // Force game to a non-playing status
      useGameStore.setState({ status: 'won' })
      s().undoMove()
      // Board still has the move
      expect(s().board[0]).toBe('X')
    })
  })

  // ── rematch ───────────────────────────────────────────────────────────────

  describe('rematch', () => {
    beforeEach(startPlaying)

    it('resets board to all-null', () => {
      s().makeMove(0)
      s().rematch()
      expect(s().board).toEqual(Array(9).fill(null))
    })

    it('preserves scores after rematch', () => {
      playXWinsTopRow()
      s().rematch()
      expect(s().scores.X).toBe(1)
    })

    it('flips currentTurn', () => {
      const before = s().currentTurn
      s().rematch()
      expect(s().currentTurn).toBe(before === 'X' ? 'O' : 'X')
    })

    it('increments round', () => {
      const r = s().round
      s().rematch()
      expect(s().round).toBe(r + 1)
    })

    it('does nothing when seriesWinner is already set', () => {
      useGameStore.setState({ seriesWinner: 'X' })
      const r = s().round
      s().rematch()
      expect(s().round).toBe(r) // no increment
    })

    it('alternates playerMark when alternating is enabled', () => {
      s().setAlternating(true)
      const mark = s().playerMark
      s().rematch()
      expect(s().playerMark).toBe(mark === 'X' ? 'O' : 'X')
    })
  })

  // ── forfeit ───────────────────────────────────────────────────────────────

  describe('forfeit', () => {
    beforeEach(startPlaying)

    it('sets status to "forfeit"', () => {
      s().forfeit()
      expect(s().status).toBe('forfeit')
    })

    it('sets winner to the opponent (non-current-turn player)', () => {
      // currentTurn starts at X, so forfeiting means O wins
      expect(s().currentTurn).toBe('X')
      s().forfeit()
      expect(s().winner).toBe('O')
    })

    it('increments the opponent score', () => {
      s().forfeit()
      expect(s().scores.O).toBe(1)
      expect(s().scores.X).toBe(0)
    })

    it('sets seriesWinner if forfeit win reaches bestOf target', () => {
      s().setBestOf(1)
      s().startGame()
      s().forfeit()
      expect(s().seriesWinner).toBe('O')
    })
  })

  // ── newGame ───────────────────────────────────────────────────────────────

  describe('newGame', () => {
    it('resets scores and returns to idle', () => {
      s().startGame()
      s().makeMove(0)
      s().newGame()
      expect(s().status).toBe('idle')
      expect(s().scores).toEqual({ X: 0, O: 0 })
      expect(s().mode).toBeNull()
    })

    it('clears board and round', () => {
      s().startGame()
      s().newGame()
      expect(s().board).toEqual(Array(9).fill(null))
      expect(s().round).toBe(1)
    })
  })
})
