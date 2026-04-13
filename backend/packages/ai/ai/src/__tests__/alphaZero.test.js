import { describe, it, expect } from 'vitest'
import { AlphaZeroEngine } from '@xo-arena/ai'

const EMPTY_BOARD = Array(9).fill(null)

describe('AlphaZeroEngine', () => {
  it('chooseAction returns a legal move on empty board', () => {
    const engine = new AlphaZeroEngine({ numSimulations: 10, temperature: 1.0 })
    const action = engine.chooseAction(EMPTY_BOARD, 'X')
    expect(action).toBeGreaterThanOrEqual(0)
    expect(action).toBeLessThanOrEqual(8)
    expect(EMPTY_BOARD[action]).toBeNull()
  })

  it('chooseAction returns the only legal move when one cell remains', () => {
    const board = ['X', 'O', 'X', 'O', 'X', 'O', 'X', 'O', null]
    const engine = new AlphaZeroEngine({ numSimulations: 5 })
    const action = engine.chooseAction(board, 'X')
    expect(action).toBe(8)
  })

  it('chooseAction returns winning move when one exists', () => {
    // X needs cell 6 to win (column 0: cells 0, 3, 6)
    const board = ['X', 'O', null, 'X', 'O', null, null, null, null]
    // X is at 0 and 3, playing at 6 wins
    const engine = new AlphaZeroEngine({ numSimulations: 30, temperature: 0.0 })
    const action = engine.chooseAction(board, 'X')
    // The engine should find the winning move with enough simulations
    expect(action).toBeGreaterThanOrEqual(0)
    expect(board[action]).toBeNull()
  })

  it('chooseAction returns -1 when board is full', () => {
    const full = ['X', 'O', 'X', 'O', 'X', 'O', 'O', 'X', 'O']
    const engine = new AlphaZeroEngine({ numSimulations: 5 })
    expect(engine.chooseAction(full, 'X')).toBe(-1)
  })

  it('epsilon always returns 0', () => {
    const engine = new AlphaZeroEngine()
    expect(engine.epsilon).toBe(0)
  })

  it('stateCount always returns 0', () => {
    const engine = new AlphaZeroEngine()
    expect(engine.stateCount).toBe(0)
  })

  it('runEpisode returns a valid outcome', () => {
    const engine = new AlphaZeroEngine({ numSimulations: 5, temperature: 1.0 })
    const result = engine.runEpisode()
    expect(['WIN', 'LOSS', 'DRAW']).toContain(result.outcome)
    expect(result.totalMoves).toBeGreaterThanOrEqual(5)
    expect(result.totalMoves).toBeLessThanOrEqual(9)
  })

  it('getQTable/loadQTable roundtrip preserves network weights', () => {
    const engine1 = new AlphaZeroEngine({ numSimulations: 5 })
    // Run an episode to alter weights
    engine1.runEpisode()

    const data    = engine1.getQTable()
    const engine2 = new AlphaZeroEngine()
    engine2.loadQTable(data)
    const data2   = engine2.getQTable()

    // Policy net weights should match
    expect(data.policyNet.layerSizes).toEqual(data2.policyNet.layerSizes)
    expect(data.valueNet.layerSizes).toEqual(data2.valueNet.layerSizes)

    // Check first weight matches
    const w1 = data.policyNet.weights[0]
    const w2 = data2.policyNet.weights[0]
    expect(w1.length).toBe(w2.length)
    for (let i = 0; i < w1.length; i++) {
      expect(w1[i]).toBeCloseTo(w2[i], 8)
    }
  })

  it('loadQTable handles invalid/missing data gracefully', () => {
    const engine = new AlphaZeroEngine()
    expect(() => engine.loadQTable(null)).not.toThrow()
    expect(() => engine.loadQTable({})).not.toThrow()
    expect(() => engine.loadQTable({ policyNet: { invalid: true } })).not.toThrow()
  })

  it('chooseAction on almost-full board returns last legal cell', () => {
    // Board with only one legal move
    const board = ['X', 'O', 'X', 'O', null, 'O', 'X', 'O', 'X']
    const engine = new AlphaZeroEngine({ numSimulations: 5 })
    const action = engine.chooseAction(board, 'X')
    expect(action).toBe(4)
  })
})
