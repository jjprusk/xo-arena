import { describe, it, expect, beforeEach } from 'vitest'
import { MonteCarloEngine } from '@xo-arena/ai'

describe('MonteCarloEngine', () => {
  let engine

  beforeEach(() => {
    engine = new MonteCarloEngine({ epsilonStart: 0, epsilonMin: 0, learningRate: 0.5, discountFactor: 0.9 })
  })

  it('initialises Q-values to zero for unseen states', () => {
    const board = Array(9).fill(null)
    const qvals = engine.getQValues(board)
    expect(qvals).toHaveLength(9)
    expect(qvals.every(v => v === 0)).toBe(true)
  })

  it('chooseAction returns a legal cell', () => {
    const board = Array(9).fill(null)
    const action = engine.chooseAction(board, false)
    expect(action).toBeGreaterThanOrEqual(0)
    expect(action).toBeLessThanOrEqual(8)
    expect(board[action]).toBeNull()
  })

  it('recordStep adds to trajectory', () => {
    const board = Array(9).fill(null)
    engine.recordStep(board, 4)
    expect(engine._trajectory).toHaveLength(1)
    expect(engine._trajectory[0].action).toBe(4)
  })

  describe('finishEpisode — backward return propagation', () => {
    it('clears trajectory after finishing', () => {
      engine.recordStep(Array(9).fill(null), 0)
      engine.finishEpisode(1.0)
      expect(engine._trajectory).toHaveLength(0)
    })

    it('updates Q(s,a) for a single-step episode with win reward', () => {
      const board = Array(9).fill(null)
      engine.recordStep(board, 4)

      const beforeQ = engine.getQValues(board)[4]
      expect(beforeQ).toBe(0)

      engine.finishEpisode(1.0)  // win

      const afterQ = engine.getQValues(board)[4]
      // alpha=0.5, G=1.0: newQ = 0 + 0.5*(1.0 - 0) = 0.5
      expect(afterQ).toBeCloseTo(0.5, 5)
    })

    it('propagates returns backward with discount', () => {
      // Two-step trajectory
      const boardA = Array(9).fill(null)
      const boardB = [...boardA]; boardB[0] = 'X'

      engine.recordStep(boardA, 0)   // t=0
      engine.recordStep(boardB, 4)   // t=1 (terminal)

      engine.finishEpisode(1.0)  // G at t=1 = 1.0, at t=0 = gamma * 1.0 = 0.9

      // t=1: Q(boardB, 4) += 0.5 * (1.0 - 0) = 0.5
      expect(engine.getQValues(boardB)[4]).toBeCloseTo(0.5, 5)

      // t=0: G=0.9, Q(boardA, 0) += 0.5 * (0.9 - 0) = 0.45
      expect(engine.getQValues(boardA)[0]).toBeCloseTo(0.45, 5)
    })

    it('propagates negative return (loss)', () => {
      const board = Array(9).fill(null)
      engine.recordStep(board, 3)
      engine.finishEpisode(-1.0)
      // alpha=0.5, G=-1.0: newQ = 0 + 0.5*(-1-0) = -0.5
      expect(engine.getQValues(board)[3]).toBeCloseTo(-0.5, 5)
    })

    it('returns average delta from finishEpisode', () => {
      const board = Array(9).fill(null)
      engine.recordStep(board, 0)
      const avgDelta = engine.finishEpisode(1.0)
      expect(avgDelta).toBeGreaterThan(0)
    })

    it('returns 0 from finishEpisode when trajectory is empty', () => {
      expect(engine.finishEpisode(1.0)).toBe(0)
    })
  })

  it('decayEpsilon floors at epsilonMin', () => {
    const e = new MonteCarloEngine({ epsilonStart: 1.0, epsilonDecay: 0.5, epsilonMin: 0.1 })
    for (let i = 0; i < 20; i++) e.decayEpsilon()
    expect(e.epsilon).toBe(0.1)
  })

  it('loadQTable / toJSON round-trip', () => {
    engine.recordStep(Array(9).fill(null), 5)
    engine.finishEpisode(0.5)
    const saved = engine.toJSON()
    const other = new MonteCarloEngine()
    other.loadQTable(saved)
    expect(other.stateCount).toBe(1)
  })
})
