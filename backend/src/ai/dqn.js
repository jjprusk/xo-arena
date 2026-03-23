/**
 * DQN (Deep Q-Network) engine for XO Arena.
 *
 * Uses a pure-JS MLP (NeuralNet) for function approximation.
 * Maintains a separate target network that is synced every
 * targetUpdateFreq gradient steps.
 *
 * Board encoding: X=+1, O=-1, null=0
 */

import { NeuralNet } from './neuralNet.js'
import { getEmptyCells } from './gameLogic.js'
import { DEFAULT_CONFIG, decayEpsilonValue } from './qLearning.js'

export class DQNEngine {
  constructor(config = {}) {
    this.replayBufferSize  = config.replayBufferSize  ?? 10000
    this.batchSize         = config.batchSize         ?? 32
    this.targetUpdateFreq  = config.targetUpdateFreq  ?? 100
    this.alpha             = config.alpha             ?? 0.001
    this.gamma             = config.gamma             ?? 0.9
    // hiddenSize controls network width; one hidden layer is sufficient for tic-tac-toe.
    // Default 32 (was 64×64 — overkill for ~5,500 board states, and 9x slower).
    const hiddenSize = config.hiddenSize ?? 32
    const layerSizes = config.layerSizes ?? [9, hiddenSize, 9]
    this._epsilon          = config.currentEpsilon ?? config.epsilonStart ?? 1.0
    this.epsilonMin        = config.epsilonMin     ?? DEFAULT_CONFIG.epsilonMin
    this.epsilonDecay      = config.epsilonDecay   ?? DEFAULT_CONFIG.epsilonDecay
    this.decayMethod       = config.decayMethod    ?? DEFAULT_CONFIG.decayMethod
    this._epsilonSessionStart = this._epsilon
    this._decayEpisode        = 0
    this._decayTotal          = config.totalEpisodes ?? null

    // Networks
    this._online = new NeuralNet(layerSizes)
    this._target = new NeuralNet(layerSizes)
    this.syncTargetNetwork() // start in sync

    // Circular replay buffer
    this._buffer   = new Array(this.replayBufferSize)
    this._bufHead  = 0
    this._bufSize  = 0

    // Step counter for target sync
    this._steps = 0
  }

  // ─── Interface ──────────────────────────────────────────────────────────────

  get epsilon() { return this._epsilon }
  get stateCount() { return 0 }

  /**
   * Epsilon-greedy action selection.
   * @param {Array} board
   * @param {string} mark  'X' or 'O'
   * @param {boolean} [explore=true]
   * @returns {number} cell index
   */
  chooseAction(board, mark, explore = true) {
    const empty = getEmptyCells(board)
    if (empty.length === 0) return -1

    if (explore && Math.random() < this._epsilon) {
      return empty[Math.floor(Math.random() * empty.length)]
    }

    const input  = _encodeBoard(board, mark)
    const { output } = this._online.forward(input)

    // Greedy over legal moves
    return empty.reduce((best, idx) => output[idx] > output[best] ? idx : best, empty[0])
  }

  /**
   * Push a (s, a, r, s', done) tuple into the replay buffer.
   */
  pushExperience(state, action, reward, nextState, done) {
    this._buffer[this._bufHead] = { state, action, reward, nextState, done }
    this._bufHead = (this._bufHead + 1) % this.replayBufferSize
    if (this._bufSize < this.replayBufferSize) this._bufSize++
  }

  /**
   * Sample a mini-batch and perform one gradient step on the online network.
   * Skips if buffer is too small.
   */
  trainStep() {
    if (this._bufSize < this.batchSize) return

    const batch = _sampleBatch(this._buffer, this._bufSize, this.batchSize)

    for (const { state, action, reward, nextState, done } of batch) {
      // Forward through online net
      const fwdOnline   = this._online.forward(state)
      const qOnline     = fwdOnline.output.slice()

      // Compute target Q-value
      let targetQ
      if (done) {
        targetQ = reward
      } else {
        const { output: qNext } = this._target.forward(nextState)
        const maxNextQ = Math.max(...qNext)
        targetQ = reward + this.gamma * maxNextQ
      }

      // MSE loss grad: 2*(Q - target) / batchSize for the action, 0 for others
      const lossGrad = new Array(9).fill(0)
      lossGrad[action] = 2 * (qOnline[action] - targetQ) / this.batchSize

      this._online.backward(lossGrad, fwdOnline.activations)
    }

    this._online.update(this.alpha)
    this._steps++

    if (this._steps % this.targetUpdateFreq === 0) {
      this.syncTargetNetwork()
    }
  }

  decayEpsilon() {
    this._decayEpisode++
    this._epsilon = decayEpsilonValue(
      this._epsilon, this.epsilonMin, this._epsilonSessionStart,
      this.decayMethod, this.epsilonDecay, this._decayEpisode, this._decayTotal,
    )
  }

  /** Copy online network weights into target network in-place (avoids serialize/deserialize). */
  syncTargetNetwork() {
    for (let l = 0; l < this._online.weights.length; l++) {
      for (let j = 0; j < this._online.weights[l].length; j++) {
        for (let i = 0; i < this._online.weights[l][j].length; i++) {
          this._target.weights[l][j][i] = this._online.weights[l][j][i]
        }
        this._target.biases[l][j] = this._online.biases[l][j]
      }
    }
  }

  // ─── Checkpoint compatibility ────────────────────────────────────────────────

  /** Returns serialized online network weights (for DB storage / checkpoint). */
  getQTable() {
    return { online: this._online.serialize(), target: this._target.serialize(), epsilon: this._epsilon }
  }

  /** Alias used by _finishSession / toJSON. */
  toJSON() {
    return this.getQTable()
  }

  loadQTable(data) {
    if (!data || typeof data !== 'object') return
    try {
      if (data.online) {
        this._online = NeuralNet.fromJSON(data.online)
        this._target = data.target ? NeuralNet.fromJSON(data.target) : NeuralNet.fromJSON(data.online)
      }
      if (typeof data.epsilon === 'number') this._epsilon = data.epsilon
    } catch (_) {
      // Ignore corrupt data gracefully
    }
  }

  /**
   * Run a forward pass and return Q-values for explainability.
   * @param {Array} board
   * @param {string} mark
   */
  explainBoard(board, mark = 'X') {
    const input = _encodeBoard(board, mark)
    const { output, activations } = this._online.forward(input)
    const empty = new Set(getEmptyCells(board))
    const qValues = Array.from({ length: 9 }, (_, i) => empty.has(i) ? output[i] : null)
    return { qValues, activations }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Encode a board array as a 9-element number array: X=+1, O=-1, null=0. */
function _encodeBoard(board, mark) {
  const opp = mark === 'X' ? 'O' : 'X'
  return board.map(c => {
    if (c === mark) return 1
    if (c === opp)  return -1
    return 0
  })
}

/** Reservoir-style random sample from the circular buffer (without replacement). */
function _sampleBatch(buffer, size, batchSize) {
  const batch = []
  const seen  = new Set()
  while (batch.length < batchSize) {
    const idx = Math.floor(Math.random() * size)
    if (!seen.has(idx) && buffer[idx]) {
      seen.add(idx)
      batch.push(buffer[idx])
    }
  }
  return batch
}
