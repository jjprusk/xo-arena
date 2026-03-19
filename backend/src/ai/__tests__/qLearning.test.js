import { describe, it, expect, beforeEach } from 'vitest'
import { QLearningEngine, runEpisode } from '../qLearning.js'

describe('QLearningEngine', () => {
  let engine

  beforeEach(() => {
    engine = new QLearningEngine({ epsilonStart: 0, epsilonMin: 0 }) // no exploration for determinism
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

  it('chooseAction picks highest Q-value cell', () => {
    const board = Array(9).fill(null)
    const qvals = engine.getQValues(board)
    qvals[4] = 99 // manually bias centre
    const action = engine.chooseAction(board, false)
    expect(action).toBe(4)
  })

  it('chooseAction skips occupied cells', () => {
    const board = ['X', 'O', 'X', 'O', 'X', 'O', 'X', 'O', null]
    const qvals = engine.getQValues(board)
    qvals.fill(-1)
    qvals[8] = 0 // only legal move
    const action = engine.chooseAction(board, false)
    expect(action).toBe(8)
  })

  it('updateQ modifies the Q-value', () => {
    const board = Array(9).fill(null)
    const next  = [...board]
    next[4] = 'X'
    const delta = engine.updateQ(board, 4, 1.0, next)
    expect(delta).toBeGreaterThan(0)
    expect(engine.getQValues(board)[4]).toBeGreaterThan(0)
  })

  it('decayEpsilon reduces epsilon but not below epsilonMin', () => {
    const e = new QLearningEngine({ epsilonStart: 1.0, epsilonDecay: 0.5, epsilonMin: 0.1 })
    e.decayEpsilon()
    expect(e.epsilon).toBe(0.5)
    e.decayEpsilon()
    expect(e.epsilon).toBe(0.25)
    e.decayEpsilon()
    expect(e.epsilon).toBeCloseTo(0.125)
    // Keep decaying — should floor at 0.1
    for (let i = 0; i < 20; i++) e.decayEpsilon()
    expect(e.epsilon).toBe(0.1)
  })

  it('stateCount grows as new states are visited', () => {
    engine.getQValues(Array(9).fill(null))
    engine.getQValues(['X', null, null, null, null, null, null, null, null])
    expect(engine.stateCount).toBe(2)
  })

  it('loadQTable restores qtable from plain object', () => {
    const saved = { 'X........': Array(9).fill(0.5) }
    engine.loadQTable(saved)
    expect(engine.stateCount).toBe(1)
  })

  it('explainBoard returns null for occupied cells', () => {
    const board = ['X', null, null, null, null, null, null, null, null]
    const result = engine.explainBoard(board)
    expect(result[0]).toBeNull()  // occupied
    expect(result[1]).not.toBeNull() // empty
  })
})

describe('runEpisode', () => {
  it('returns a valid outcome', () => {
    const engine = new QLearningEngine()
    const result = runEpisode(engine, 'both', null)
    expect(['WIN', 'LOSS', 'DRAW']).toContain(result.outcome)
  })

  it('returns totalMoves between 5 and 9', () => {
    const engine = new QLearningEngine()
    const result = runEpisode(engine, 'both', null)
    expect(result.totalMoves).toBeGreaterThanOrEqual(5)
    expect(result.totalMoves).toBeLessThanOrEqual(9)
  })

  it('updates Q-table (stateCount > 0 after episode)', () => {
    const engine = new QLearningEngine()
    runEpisode(engine, 'both', null)
    expect(engine.stateCount).toBeGreaterThan(0)
  })

  it('works vs a random opponent', () => {
    const engine = new QLearningEngine()
    const { getEmptyCells } = require('../gameLogic.js')
    const randomOpp = (board) => {
      const empty = getEmptyCells(board)
      return empty[Math.floor(Math.random() * empty.length)]
    }
    const result = runEpisode(engine, 'X', randomOpp)
    expect(['WIN', 'LOSS', 'DRAW']).toContain(result.outcome)
  })

  it('decays epsilon after each episode', () => {
    const engine = new QLearningEngine({ epsilonStart: 1.0, epsilonDecay: 0.9, epsilonMin: 0.01 })
    const epsBefore = engine.epsilon
    runEpisode(engine, 'both', null)
    expect(engine.epsilon).toBeLessThan(epsBefore)
  })
})
