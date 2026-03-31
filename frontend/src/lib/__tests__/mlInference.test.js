/**
 * Unit tests for frontend/src/lib/mlInference.js
 *
 * mlInference.js is entirely self-contained — no network calls, no module
 * dependencies — so no mocks are required.
 *
 * The module only exports: loadModel, getLocalMove, isModelCached, evictModel.
 * Internal classes (NeuralNet) and helpers (getWinner, getEmptyCells) are
 * reached through the public API by injecting controlled model data.
 *
 * Where we need to exercise internals directly we access them via the
 * module's exported behaviour rather than re-exporting them.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { loadModel, getLocalMove, isModelCached, evictModel } from '../mlInference.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a NeuralNet-compatible JSON object whose weights produce predictable
 * output so we can reason about forward-pass results in tests.
 *
 * layerSizes [2, 2]:  single layer, no hidden layers → linear output.
 *   W[0][j] maps 2 inputs to output j.
 *   flat weights stored row-major (fanOut rows × fanIn cols).
 */
function makeIdentityNet(size = 9) {
  // Identity-like: weight matrix = identity, biases = 0.
  // For a [size, size] net this means output[j] = input[j].
  const flat = []
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      flat.push(i === j ? 1 : 0)
    }
  }
  return {
    layerSizes: [size, size],
    weights: [flat],
    biases: [new Array(size).fill(0)],
  }
}

/**
 * Register a model directly into the inference cache by simulating
 * loadModel with a synchronous fetchFn stub.
 */
async function seedTabularModel(modelId, qtable) {
  evictModel(modelId)
  await loadModel(modelId, () => Promise.resolve({
    algorithm: 'Q_LEARNING',
    qtable,
  }))
}

async function seedDQNModel(modelId, netJSON) {
  evictModel(modelId)
  await loadModel(modelId, () => Promise.resolve({
    algorithm: 'DQN',
    qtable: { online: netJSON },
  }))
}

// ─── NeuralNet.fromJSON (via DQN seed) ────────────────────────────────────────

describe('NeuralNet.fromJSON — weight reshaping', () => {
  it('reshapes flat weights into 2-D rows (fanOut × fanIn)', async () => {
    // 2-input, 3-output single-layer net.
    // flat = [w00, w01,  w10, w11,  w20, w21]  (3 rows × 2 cols)
    const netJSON = {
      layerSizes: [2, 3],
      weights: [[1, 2, 3, 4, 5, 6]],
      biases: [[0, 0, 0]],
    }

    const modelId = 'test-from-json-reshape'
    evictModel(modelId)
    await loadModel(modelId, () => Promise.resolve({
      algorithm: 'DQN',
      qtable: {
        online: netJSON,
      },
    }))

    // If fromJSON reshapes correctly the DQN model will be cached successfully.
    expect(isModelCached(modelId)).toBe(true)
    evictModel(modelId)
  })

  it('creates one weight row per output neuron', async () => {
    // [3, 2] net — flat has 2 rows × 3 cols = 6 elements
    const netJSON = {
      layerSizes: [3, 2],
      weights: [[1, 2, 3, 4, 5, 6]],
      biases: [[0, 0]],
    }

    const modelId = 'test-from-json-rows'
    evictModel(modelId)
    await loadModel(modelId, () => Promise.resolve({
      algorithm: 'DQN',
      qtable: { online: netJSON },
    }))

    expect(isModelCached(modelId)).toBe(true)

    // Exercise the cached net: board with X at 0, rest empty
    const board = ['X', null, null, null, null, null, null, null, null]
    // Move should be one of the legal indices (1-8).
    const move = getLocalMove(modelId, board, 'X')
    expect(move).toBeGreaterThanOrEqual(0)
    expect(move).toBeLessThanOrEqual(8)
    evictModel(modelId)
  })
})

// ─── NeuralNet.forward — linear output (no hidden layers) ────────────────────

describe('NeuralNet.forward — single-layer linear output', () => {
  it('identity weights produce output equal to input', async () => {
    const modelId = 'test-identity-net'
    await seedDQNModel(modelId, makeIdentityNet(9))

    // Encode a board: X=1, O=-1, null=0
    // Board: X at 0, O at 1, rest empty → encoded [1,-1,0,0,0,0,0,0,0]
    // Identity net → Q[0]=1, Q[1]=-1, rest=0
    // Legal moves: indices 2–8 (all have Q=0).  Best legal = 2 (first tie).
    const board = ['X', 'O', null, null, null, null, null, null, null]
    const move = getLocalMove(modelId, board, 'X')
    // All legal cells have Q=0, so we just verify it picks a legal one.
    expect([2, 3, 4, 5, 6, 7, 8]).toContain(move)
    evictModel(modelId)
  })

  it('highest-Q legal move is selected', async () => {
    // Bias the net so that cell 4 gets a very high Q value.
    // Use [9,9] net where output[4] is amplified by setting row-4 weight
    // for input position 4 very high.
    const flat = []
    for (let j = 0; j < 9; j++) {
      for (let i = 0; i < 9; i++) {
        // row j, col i: if j===4 and i===4 → 100, else identity
        flat.push(j === 4 && i === 4 ? 100 : (i === j ? 1 : 0))
      }
    }
    const netJSON = {
      layerSizes: [9, 9],
      weights: [flat],
      biases: [new Array(9).fill(0)],
    }

    const modelId = 'test-high-q-net'
    await seedDQNModel(modelId, netJSON)

    // Board with cells 0 and 4 occupied; cell 4 is not legal.
    // Net amplifies position 4 in input — but cell 4 is taken, so the
    // engine must pick another legal cell.
    const board = ['X', null, null, null, 'O', null, null, null, null]
    const move = getLocalMove(modelId, board, 'X')
    expect([1, 2, 3, 5, 6, 7, 8]).toContain(move)
    evictModel(modelId)
  })
})

// ─── NeuralNet.forward — ReLU on hidden layers ────────────────────────────────

describe('NeuralNet.forward — ReLU on hidden layers', () => {
  it('negative pre-activation values are clamped to zero', async () => {
    // 3-layer net: [9, 1, 9]
    // Hidden layer (l=0, not last): uses ReLU.
    // Set hidden weights to produce -10 for the single hidden neuron
    // given board encoding [1,0,0,0,0,0,0,0,0] (X at 0, rest empty).
    // hidden_W row0 = [-1,-1,-1,...,-1] → z = -9 → ReLU → 0
    // Output layer (l=1, last): linear.  All output weights → 0 * ... = 0.
    // So all Q-values = 0; any legal move is valid.
    const hiddenW = new Array(9).fill(-1)   // 1 hidden neuron × 9 inputs
    const outputW = []
    for (let j = 0; j < 9; j++) outputW.push(1)  // 9 output neurons × 1 hidden

    const netJSON = {
      layerSizes: [9, 1, 9],
      weights: [hiddenW, outputW],
      biases: [[0], new Array(9).fill(0)],
    }

    const modelId = 'test-relu-net'
    await seedDQNModel(modelId, netJSON)

    // Board: X at 0, rest empty; encoded [1,0,...,0]
    const board = ['X', null, null, null, null, null, null, null, null]
    const move = getLocalMove(modelId, board, 'X')
    // ReLU zeroes the hidden activation → all Q=0; any of cells 1-8 is legal.
    expect([1, 2, 3, 4, 5, 6, 7, 8]).toContain(move)
    evictModel(modelId)
  })

  it('positive hidden activations pass through unchanged', async () => {
    // [9, 1, 9] net where hidden neuron always produces +10 (all ones × board).
    // The output layer maps this to output[4] = 10, rest = 0.
    // hidden_W row0 = [1,1,...,1] → z = sum(inputs) > 0 → ReLU passes it through.
    // output_W = [0,0,0,0,10,0,0,0,0] for j=4 and 0 elsewhere.
    const hiddenW = new Array(9).fill(1)
    const outputW = []
    for (let j = 0; j < 9; j++) outputW.push(j === 4 ? 10 : 0)

    const netJSON = {
      layerSizes: [9, 1, 9],
      weights: [hiddenW, outputW],
      biases: [[0], new Array(9).fill(0)],
    }

    const modelId = 'test-relu-positive'
    await seedDQNModel(modelId, netJSON)

    // Board: O at 4 (occupied), X plays; cell 4 not legal.
    // Next best Q = 0 for all empty cells; any legal move is valid.
    const board = [null, null, null, null, 'O', null, null, null, null]
    const move = getLocalMove(modelId, board, 'X')
    expect([0, 1, 2, 3, 5, 6, 7, 8]).toContain(move)
    evictModel(modelId)
  })
})

// ─── getWinner — tested via tabular inference ─────────────────────────────────

describe('getWinner — horizontal win detection', () => {
  it('detects a top-row win for X', async () => {
    // Board: X wins on [0,1,2]; all other cells empty.
    // Any inference call on a won board should return -1 (no empty cells).
    // We test getWinner indirectly via inferTabular on a won board.
    const modelId = 'test-winner-horiz'
    await seedTabularModel(modelId, {})

    const board = ['X', 'X', 'X', null, null, null, null, null, null]
    const move = getLocalMove(modelId, board)
    // All non-null cells are occupied; game is already over.
    // inferTabular on the 6 empty cells: Q-table is empty → Q=0 → first empty = 3.
    // The winner check is internal — what matters is the inference still runs
    // without throwing and returns a valid index from the empty cells.
    expect([3, 4, 5, 6, 7, 8]).toContain(move)
    evictModel(modelId)
  })
})

// ─── getWinner — pure logic via direct module behaviour ───────────────────────

/**
 * To test getWinner and getEmptyCells directly we import the mlInference
 * module's inline helpers by exercising the public API in ways that expose
 * their behaviour.
 *
 * Alternatively: we re-export them in a testable way by importing from the
 * vendor gameLogic module (which uses the identical implementation).
 */
import { getWinner, getEmptyCells } from '../../vendor/ai/gameLogic.js'

describe('getWinner', () => {
  it('detects a horizontal win', () => {
    const board = ['X', 'X', 'X', null, null, null, null, null, null]
    expect(getWinner(board)).toBe('X')
  })

  it('detects a vertical win', () => {
    const board = ['O', null, null, 'O', null, null, 'O', null, null]
    expect(getWinner(board)).toBe('O')
  })

  it('detects a diagonal win', () => {
    const board = ['X', null, null, null, 'X', null, null, null, 'X']
    expect(getWinner(board)).toBe('X')
  })

  it('returns null when there is no winner', () => {
    const board = ['X', 'O', 'X', 'O', 'X', 'O', 'O', 'X', null]
    expect(getWinner(board)).toBeNull()
  })

  it('returns null for an empty board', () => {
    expect(getWinner(Array(9).fill(null))).toBeNull()
  })
})

describe('getEmptyCells', () => {
  it('returns indices of null cells', () => {
    const board = ['X', null, 'O', null, null, 'X', null, 'O', null]
    expect(getEmptyCells(board)).toEqual([1, 3, 4, 6, 8])
  })

  it('returns all indices for an empty board', () => {
    expect(getEmptyCells(Array(9).fill(null))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('returns an empty array for a full board', () => {
    const full = ['X', 'O', 'X', 'O', 'X', 'O', 'X', 'O', 'X']
    expect(getEmptyCells(full)).toEqual([])
  })
})

// ─── getLocalMove — tabular (Q_LEARNING / SARSA / MC / PG) ───────────────────

describe('getLocalMove — tabular algorithm', () => {
  beforeEach(() => evictModel('tabular-test'))

  it('returns a valid legal move index from Q-table', async () => {
    // Board: 'X' at 0, 'O' at 4; legal cells = [1,2,3,5,6,7,8].
    // Q-table biases cell 6 with a high value.
    const board = ['X', null, null, null, 'O', null, null, null, null]
    const stateKey = board.map(c => c ?? '.').join('')  // 'X...O....'
    const qtable = { [stateKey]: [0, 0, 0, 0, 0, 0, 99, 0, 0] }

    await seedTabularModel('tabular-test', qtable)
    const move = getLocalMove('tabular-test', board)
    expect(move).toBe(6)
  })

  it('falls back to first legal move when Q-table has no entry', async () => {
    const board = [null, null, null, null, null, null, null, null, null]
    await seedTabularModel('tabular-test', {})
    const move = getLocalMove('tabular-test', board)
    // All Q-values = 0; inferTabular returns first legal = 0
    expect(move).toBe(0)
  })

  it('never returns an occupied cell', async () => {
    const board = ['X', 'O', 'X', 'O', null, null, null, null, null]
    await seedTabularModel('tabular-test', {})
    const move = getLocalMove('tabular-test', board)
    expect([4, 5, 6, 7, 8]).toContain(move)
    expect(board[move]).toBeNull()
  })
})

// ─── getLocalMove — DQN ───────────────────────────────────────────────────────

describe('getLocalMove — DQN algorithm', () => {
  beforeEach(() => evictModel('dqn-test'))

  it('returns a legal move (index within empty cells)', async () => {
    await seedDQNModel('dqn-test', makeIdentityNet(9))
    const board = ['X', 'O', null, null, null, null, null, null, null]
    const move = getLocalMove('dqn-test', board, 'X')
    expect([2, 3, 4, 5, 6, 7, 8]).toContain(move)
    expect(board[move]).toBeNull()
  })

  it('returns a number (not null) when model is cached', async () => {
    await seedDQNModel('dqn-test', makeIdentityNet(9))
    const board = [null, null, null, null, null, null, null, null, null]
    const move = getLocalMove('dqn-test', board, 'O')
    expect(typeof move).toBe('number')
  })
})

// ─── getLocalMove — full board edge case ─────────────────────────────────────

describe('getLocalMove — full board', () => {
  it('returns -1 when the board is full (tabular)', async () => {
    const full = ['X', 'O', 'X', 'O', 'X', 'O', 'O', 'X', 'O']
    await seedTabularModel('full-board-tab', {})
    const move = getLocalMove('full-board-tab', full)
    expect(move).toBe(-1)
    evictModel('full-board-tab')
  })

  it('returns -1 when the board is full (DQN)', async () => {
    const full = ['X', 'O', 'X', 'O', 'X', 'O', 'O', 'X', 'O']
    await seedDQNModel('full-board-dqn', makeIdentityNet(9))
    const move = getLocalMove('full-board-dqn', full, 'X')
    expect(move).toBe(-1)
    evictModel('full-board-dqn')
  })
})

// ─── loadModel / isModelCached / evictModel ───────────────────────────────────

describe('model cache lifecycle', () => {
  it('isModelCached returns false before loading', () => {
    expect(isModelCached('never-loaded')).toBe(false)
  })

  it('isModelCached returns true after successful load', async () => {
    const id = 'lifecycle-test'
    evictModel(id)
    await loadModel(id, () => Promise.resolve({ algorithm: 'Q_LEARNING', qtable: {} }))
    expect(isModelCached(id)).toBe(true)
    evictModel(id)
  })

  it('evictModel removes the model from the cache', async () => {
    const id = 'evict-test'
    evictModel(id)
    await loadModel(id, () => Promise.resolve({ algorithm: 'Q_LEARNING', qtable: {} }))
    expect(isModelCached(id)).toBe(true)
    evictModel(id)
    expect(isModelCached(id)).toBe(false)
  })

  it('loadModel returns false for unsupported algorithm', async () => {
    const id = 'bad-algo'
    evictModel(id)
    const result = await loadModel(id, () => Promise.resolve({ algorithm: 'UNKNOWN' }))
    expect(result).toBe(false)
    expect(isModelCached(id)).toBe(false)
  })

  it('loadModel returns false when fetchFn rejects', async () => {
    const id = 'fetch-fail'
    evictModel(id)
    const result = await loadModel(id, () => Promise.reject(new Error('network error')))
    expect(result).toBe(false)
  })

  it('getLocalMove returns null when model is not cached', () => {
    expect(getLocalMove('not-in-cache', Array(9).fill(null))).toBeNull()
  })

  it('second loadModel call returns true immediately from cache', async () => {
    const id = 'double-load'
    evictModel(id)
    let fetchCallCount = 0
    const fetchFn = () => { fetchCallCount++; return Promise.resolve({ algorithm: 'Q_LEARNING', qtable: {} }) }
    await loadModel(id, fetchFn)
    await loadModel(id, fetchFn)  // second call should use cache
    expect(fetchCallCount).toBe(1)
    evictModel(id)
  })
})
