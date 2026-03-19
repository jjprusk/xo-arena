import { describe, it, expect, beforeEach } from 'vitest'
import { DQNEngine } from '../dqn.js'

const EMPTY_BOARD = Array(9).fill(null)
const MARK = 'X'

describe('DQNEngine', () => {
  let engine

  beforeEach(() => {
    engine = new DQNEngine({
      replayBufferSize: 100,
      batchSize: 4,
      targetUpdateFreq: 10,
      alpha: 0.001,
      gamma: 0.9,
      epsilonStart: 0,   // no exploration for determinism
      epsilonMin: 0,
      epsilonDecay: 1.0,
    })
  })

  it('chooseAction returns a legal move on empty board', () => {
    const action = engine.chooseAction(EMPTY_BOARD, MARK, false)
    expect(action).toBeGreaterThanOrEqual(0)
    expect(action).toBeLessThanOrEqual(8)
    expect(EMPTY_BOARD[action]).toBeNull()
  })

  it('chooseAction returns a legal move on partially filled board', () => {
    const board = ['X', 'O', null, null, null, null, null, null, null]
    const action = engine.chooseAction(board, MARK, false)
    expect(action).toBeGreaterThanOrEqual(2)  // first two cells are occupied
    expect(board[action]).toBeNull()
  })

  it('chooseAction returns -1 when board is full', () => {
    const full = ['X', 'O', 'X', 'O', 'X', 'O', 'X', 'O', 'X']
    expect(engine.chooseAction(full, MARK, false)).toBe(-1)
  })

  it('chooseAction with exploration can return random move', () => {
    const exploringEngine = new DQNEngine({ epsilonStart: 1.0, epsilonMin: 1.0, epsilonDecay: 1.0, batchSize: 4 })
    const actions = new Set()
    for (let i = 0; i < 50; i++) {
      actions.add(exploringEngine.chooseAction(EMPTY_BOARD, MARK, true))
    }
    // With epsilon=1, should see multiple different legal moves
    expect(actions.size).toBeGreaterThan(1)
  })

  it('pushExperience fills the replay buffer', () => {
    expect(engine._bufSize).toBe(0)
    const state = Array(9).fill(0)
    for (let i = 0; i < 10; i++) {
      engine.pushExperience(state, i % 9, 0, state, false)
    }
    expect(engine._bufSize).toBe(10)
  })

  it('replay buffer wraps around when full (circular)', () => {
    const eng = new DQNEngine({ replayBufferSize: 5, batchSize: 2 })
    const state = Array(9).fill(0)
    for (let i = 0; i < 10; i++) {
      eng.pushExperience(state, 0, i, state, false)
    }
    expect(eng._bufSize).toBe(5)     // capped at capacity
    expect(eng._bufHead).toBe(0)     // wrapped around (10 % 5 = 0)
  })

  it('trainStep skips when buffer has fewer entries than batchSize', () => {
    const state = Array(9).fill(0)
    // Push only 2 experiences, batchSize is 4
    engine.pushExperience(state, 0, 1, state, true)
    engine.pushExperience(state, 1, 0, state, false)
    expect(engine._bufSize).toBe(2)

    // Should not throw and should not increment steps
    const stepsBefore = engine._steps
    engine.trainStep()
    expect(engine._steps).toBe(stepsBefore)
  })

  it('trainStep runs without error when buffer is large enough', () => {
    const state = Array(9).fill(0)
    for (let i = 0; i < 20; i++) {
      engine.pushExperience(state, i % 9, i % 2 === 0 ? 1 : -1, state, i % 3 === 0)
    }
    expect(() => engine.trainStep()).not.toThrow()
    expect(engine._steps).toBeGreaterThan(0)
  })

  it('decayEpsilon reduces epsilon correctly', () => {
    const eng = new DQNEngine({ epsilonStart: 1.0, epsilonDecay: 0.9, epsilonMin: 0.1 })
    expect(eng.epsilon).toBeCloseTo(1.0)
    eng.decayEpsilon()
    expect(eng.epsilon).toBeCloseTo(0.9)
    eng.decayEpsilon()
    expect(eng.epsilon).toBeCloseTo(0.81)
    // Decay to floor
    for (let i = 0; i < 100; i++) eng.decayEpsilon()
    expect(eng.epsilon).toBeCloseTo(0.1)
  })

  it('stateCount always returns 0', () => {
    expect(engine.stateCount).toBe(0)
  })

  it('getQTable/loadQTable roundtrip restores network', () => {
    const state = Array(9).fill(0)
    // Do some training to alter weights
    for (let i = 0; i < 20; i++) {
      engine.pushExperience(state, i % 9, 1, state, i % 5 === 0)
    }
    engine.trainStep()

    const table1 = engine.getQTable()
    const eng2   = new DQNEngine({ batchSize: 4 })
    eng2.loadQTable(table1)
    const table2 = eng2.getQTable()

    // Online weights should be the same after roundtrip
    const w1 = table1.online.weights.map(l => l.slice())
    const w2 = table2.online.weights.map(l => l.slice())
    expect(w1).toEqual(w2)
  })

  it('syncTargetNetwork copies online weights to target', () => {
    // Manually perturb online weights
    engine._online.weights[0][0][0] = 999
    engine.syncTargetNetwork()
    expect(engine._target.weights[0][0][0]).toBe(999)
  })

  it('epsilon getter returns current epsilon value', () => {
    const eng = new DQNEngine({ epsilonStart: 0.42, epsilonMin: 0, epsilonDecay: 1.0 })
    expect(eng.epsilon).toBeCloseTo(0.42)
  })
})
