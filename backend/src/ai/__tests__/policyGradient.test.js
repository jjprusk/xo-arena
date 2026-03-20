import { describe, it, expect, beforeEach } from 'vitest'
import { PolicyGradientEngine } from '../policyGradient.js'

describe('PolicyGradientEngine', () => {
  let engine

  beforeEach(() => {
    engine = new PolicyGradientEngine({ alpha: 0.1, gamma: 0.9 })
  })

  it('chooseAction returns a legal cell index', () => {
    const board = Array(9).fill(null)
    const action = engine.chooseAction(board, true)
    expect(action).toBeGreaterThanOrEqual(0)
    expect(action).toBeLessThanOrEqual(8)
    expect(board[action]).toBeNull()
  })

  it('chooseAction only samples from legal moves', () => {
    // Only cell 8 is free
    const board = ['X', 'O', 'X', 'O', 'X', 'O', 'X', 'O', null]
    for (let i = 0; i < 20; i++) {
      const action = engine.chooseAction(board, true)
      expect(action).toBe(8)
    }
  })

  it('chooseAction (exploit) picks argmax of theta', () => {
    const board = Array(9).fill(null)
    engine.getQValues(board)[7] = 99  // bias cell 7
    const action = engine.chooseAction(board, false)
    expect(action).toBe(7)
  })

  it('recordStep adds to trajectory', () => {
    engine.recordStep(Array(9).fill(null), 4, -0.3)
    expect(engine._trajectory).toHaveLength(1)
    expect(engine._trajectory[0].action).toBe(4)
  })

  describe('finishEpisode — policy gradient update', () => {
    it('clears trajectory after finishing', () => {
      engine.recordStep(Array(9).fill(null), 0, 0)
      engine.finishEpisode(1.0)
      expect(engine._trajectory).toHaveLength(0)
    })

    it('increases theta for chosen action on win', () => {
      const board = Array(9).fill(null)
      // Manually record step and finish with positive reward
      engine.recordStep(board, 4, 0)
      engine.finishEpisode(1.0)

      // theta(s, 4) should increase (chosen action with positive G_t)
      const theta = engine.getQValues(board)
      expect(theta[4]).toBeGreaterThan(0)
    })

    it('decreases theta for chosen action on loss', () => {
      const board = Array(9).fill(null)
      engine.recordStep(board, 4, 0)
      engine.finishEpisode(-1.0)

      const theta = engine.getQValues(board)
      expect(theta[4]).toBeLessThan(0)
    })

    it('updates unchosen legal actions in the opposite direction', () => {
      const board = Array(9).fill(null)
      // Only two cells available
      const smallBoard = ['X', 'O', 'X', 'O', 'X', 'O', 'X', null, null]
      engine.recordStep(smallBoard, 7, 0)
      engine.finishEpisode(1.0)

      // Cell 7 chosen — theta[7] increases; cell 8 (unchosen) decreases
      const theta = engine.getQValues(smallBoard)
      expect(theta[7]).toBeGreaterThan(0)
      expect(theta[8]).toBeLessThan(0)
    })

    it('returns 0 when trajectory is empty', () => {
      expect(engine.finishEpisode(1.0)).toBe(0)
    })

    it('returns positive average delta on non-trivial episode', () => {
      engine.recordStep(Array(9).fill(null), 0, 0)
      const delta = engine.finishEpisode(1.0)
      expect(delta).toBeGreaterThan(0)
    })

    it('multi-step return is discounted backward', () => {
      const boardA = Array(9).fill(null)
      const boardB = [...boardA]; boardB[0] = 'X'

      engine.recordStep(boardA, 0, 0)  // t=0, G_0 = gamma * G_1 = 0.9
      engine.recordStep(boardB, 4, 0)  // t=1, G_1 = 1.0

      engine.finishEpisode(1.0)

      // t=1 gets G=1.0, t=0 gets G=0.9
      // Both should push chosen action in positive direction
      expect(engine.getQValues(boardA)[0]).toBeGreaterThan(0)
      expect(engine.getQValues(boardB)[4]).toBeGreaterThan(0)
    })
  })

  it('decayEpsilon floors at epsilonMin', () => {
    const e = new PolicyGradientEngine({ alpha: 0.01 })
    e.epsilon = 1.0
    e.epsilonDecay = 0.5
    e.epsilonMin = 0.05
    for (let i = 0; i < 30; i++) e.decayEpsilon()
    expect(e.epsilon).toBe(0.05)
  })

  it('loadQTable / toJSON round-trip preserves theta values', () => {
    engine.recordStep(Array(9).fill(null), 3, 0)
    engine.finishEpisode(1.0)

    const saved = engine.toJSON()
    const other = new PolicyGradientEngine()
    other.loadQTable(saved)
    expect(other.stateCount).toBe(1)
    const theta = other.getQValues(Array(9).fill(null))
    expect(theta[3]).toBeGreaterThan(0)
  })

  it('explainBoard returns null for occupied cells', () => {
    const board = ['X', null, null, null, null, null, null, null, null]
    const result = engine.explainBoard(board)
    expect(result[0]).toBeNull()
    expect(result[1]).not.toBeNull()
  })
})
