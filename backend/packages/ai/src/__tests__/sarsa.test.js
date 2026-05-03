import { describe, it, expect, beforeEach } from 'vitest'
import { SarsaEngine } from '@xo-arena/ai'

describe('SarsaEngine', () => {
  let engine

  beforeEach(() => {
    engine = new SarsaEngine({ epsilonStart: 0, epsilonMin: 0 })
  })

  it('initialises Q-values to zero for unseen states', () => {
    const board = Array(9).fill(null)
    const qvals = engine.getQValues(board)
    expect(qvals).toHaveLength(9)
    expect(qvals.every(v => v === 0)).toBe(true)
  })

  it('stateKey produces consistent strings', () => {
    const board = ['X', null, 'O', null, 'X', null, null, null, null]
    expect(engine.stateKey(board)).toBe('X.O.X....')
  })

  it('chooseAction returns a legal cell index', () => {
    const board = Array(9).fill(null)
    const action = engine.chooseAction(board, false)
    expect(action).toBeGreaterThanOrEqual(0)
    expect(action).toBeLessThanOrEqual(8)
    expect(board[action]).toBeNull()
  })

  it('chooseAction skips occupied cells', () => {
    const board = ['X', 'O', 'X', 'O', 'X', 'O', 'X', 'O', null]
    const qvals = engine.getQValues(board)
    qvals.fill(-1)
    qvals[8] = 0
    const action = engine.chooseAction(board, false)
    expect(action).toBe(8)
  })

  describe('update — SARSA on-policy update', () => {
    it('modifies Q(s,a) in the direction of the SARSA target', () => {
      const board = Array(9).fill(null)
      const nextBoard = [...board]; nextBoard[4] = 'X'

      // Manually prime next-state Q-values
      const nextQvals = engine.getQValues(nextBoard)
      nextQvals[0] = 0.5  // Q(s', a') where a' = 0

      const delta = engine.update(board, 4, 0, nextBoard, 0 /* nextAction */, false)

      expect(delta).toBeGreaterThan(0)
      // Q(s,4) should move toward 0 + gamma * Q(s', 0)
      expect(engine.getQValues(board)[4]).toBeGreaterThan(0)
    })

    it('uses nextAction Q-value (not max), unlike Q-Learning', () => {
      const board = Array(9).fill(null)
      const nextBoard = [...board]; nextBoard[0] = 'X'

      const nextQvals = engine.getQValues(nextBoard)
      // Set up next state: cell 1 has high Q, cell 2 has low Q
      nextQvals[1] = 1.0  // max Q
      nextQvals[2] = 0.1  // actual next action will be 2

      // SARSA uses nextAction=2 (actual chosen), not argmax=1
      engine.update(board, 0, 0, nextBoard, 2 /* nextAction — NOT the max */, false)

      const q_sa = engine.getQValues(board)[0]
      // Target = 0 + gamma * Q(s', 2) = 0.9 * 0.1 = 0.09
      // With alpha=0.3: new Q = 0 + 0.3 * (0.09 - 0) = 0.027
      expect(q_sa).toBeCloseTo(0.027, 3)
    })

    it('sets nextQ=0 on terminal step (done=true)', () => {
      const board = Array(9).fill(null)
      const nextBoard = [...board]; nextBoard[4] = 'X'

      // Even if next state has Q values, terminal update ignores them
      engine.getQValues(nextBoard).fill(99)

      const beforeQ = engine.getQValues(board)[4]
      engine.update(board, 4, 1.0, nextBoard, 0, true /* done */)
      const afterQ = engine.getQValues(board)[4]

      // Target = reward + 0 (done), so Q moves toward reward=1.0
      expect(afterQ).toBeGreaterThan(beforeQ)
      // alpha=0.3, so: 0 + 0.3*(1.0 - 0) = 0.3
      expect(afterQ).toBeCloseTo(0.3, 5)
    })
  })

  it('decayEpsilon reduces epsilon but not below epsilonMin', () => {
    const e = new SarsaEngine({ epsilonStart: 1.0, epsilonDecay: 0.5, epsilonMin: 0.1 })
    e.decayEpsilon()
    expect(e.epsilon).toBe(0.5)
    for (let i = 0; i < 20; i++) e.decayEpsilon()
    expect(e.epsilon).toBe(0.1)
  })

  it('stateCount grows as new states are visited', () => {
    engine.getQValues(Array(9).fill(null))
    engine.getQValues(['X', null, null, null, null, null, null, null, null])
    expect(engine.stateCount).toBe(2)
  })

  it('loadQTable / toJSON round-trip works', () => {
    engine.getQValues(Array(9).fill(null))[4] = 0.7
    const saved = engine.toJSON()
    const restored = new SarsaEngine()
    restored.loadQTable(saved)
    expect(restored.stateCount).toBe(1)
    expect(restored.getQValues(Array(9).fill(null))[4]).toBeCloseTo(0.7)
  })
})
