/**
 * REINFORCE policy gradient engine (simplified, tabular softmax policy).
 *
 * Policy: π(a|s) = softmax(θ(s, ·)) over legal moves.
 *
 * Update rule (REINFORCE):
 *   θ(s,a) ← θ(s,a) + α · G_t · ∇_θ log π(a|s)
 *
 * For softmax:
 *   ∇_θ log π(a|s) at position a  = 1 - π(a|s)   (chosen action)
 *   ∇_θ log π(a|s) at position a' = - π(a'|s)    (other legal actions)
 */

import { getEmptyCells } from './gameLogic.js'

export class PolicyGradientEngine {
  constructor(config = {}) {
    this.alpha   = config.alpha   ?? config.learningRate ?? 0.01
    this.gamma   = config.gamma   ?? config.discountFactor ?? 0.9
    // Epsilon kept for interface parity — PG uses softmax sampling but
    // we still honour the concept so external code can read engine.epsilon
    this.epsilon    = config.currentEpsilon ?? config.epsilonStart ?? 1.0
    this.epsilonMin = config.epsilonMin  ?? 0.05
    this.epsilonDecay = config.epsilonDecay ?? 0.995
    /**
     * Policy parameters θ: same structure as Q-table for interface parity.
     * Keyed by stateKey → 9-element array of preference scores.
     * @type {Object.<string, number[]>}
     */
    this.qtable = {}   // stores θ, not Q-values — named qtable for interface parity
    /** Episode trajectory: [{board, action, logProb}, ...] */
    this._trajectory = []
  }

  stateKey(board) {
    return board.map(c => c ?? '.').join('')
  }

  /** Return (initialising if needed) the 9-element theta array for a state. */
  getQValues(board) {
    const key = this.stateKey(board)
    if (!this.qtable[key]) this.qtable[key] = Array(9).fill(0)
    return this.qtable[key]
  }

  get stateCount() {
    return Object.keys(this.qtable).length
  }

  /**
   * Compute softmax probabilities over legal moves only.
   * Returns a Map from cell index → probability.
   */
  _softmax(board) {
    const empty  = getEmptyCells(board)
    const theta  = this.getQValues(board)
    const logits = empty.map(i => theta[i])

    // Numerically stable softmax
    const maxL = Math.max(...logits)
    const exps = logits.map(l => Math.exp(l - maxL))
    const sumE = exps.reduce((s, e) => s + e, 0)
    const probs = new Map()
    empty.forEach((i, j) => probs.set(i, exps[j] / sumE))
    return probs
  }

  /**
   * Choose an action by sampling from the softmax policy over legal moves.
   * @param {Array}   board
   * @param {boolean} explore - if false, picks greedy argmax (for exploitation)
   * @returns {number} cell index
   */
  chooseAction(board, explore = true) {
    const empty = getEmptyCells(board)
    if (empty.length === 0) return -1

    if (!explore) {
      // Pure exploitation: argmax of theta
      const theta = this.getQValues(board)
      return empty.reduce((best, idx) => theta[idx] > theta[best] ? idx : best, empty[0])
    }

    const probs = this._softmax(board)
    const r = Math.random()
    let cumulative = 0
    for (const [idx, p] of probs) {
      cumulative += p
      if (r <= cumulative) return idx
    }
    // Fallback (floating point edge case)
    return [...probs.keys()].pop()
  }

  /**
   * Record a step for the current episode.
   * @param {Array}  state   board before action
   * @param {number} action  action chosen
   * @param {number} logProb log π(a|s) at time of choice (for reference; recomputed in finishEpisode)
   */
  recordStep(state, action, logProb) {
    this._trajectory.push({ board: [...state], action, logProb })
  }

  /**
   * Finish the episode: compute returns and update θ.
   * @param {number} finalReward  episode terminal reward
   * @returns {number} average absolute param update
   */
  finishEpisode(finalReward) {
    const traj = this._trajectory
    this._trajectory = []

    if (traj.length === 0) return 0

    // Compute discounted returns G_t from the end
    const returns = Array(traj.length).fill(0)
    returns[traj.length - 1] = finalReward
    for (let t = traj.length - 2; t >= 0; t--) {
      returns[t] = this.gamma * returns[t + 1]
    }

    let totalDelta = 0

    for (let t = 0; t < traj.length; t++) {
      const { board, action } = traj[t]
      const G_t  = returns[t]
      const probs = this._softmax(board)
      const empty = getEmptyCells(board)
      const theta = this.getQValues(board)

      // Update θ for all legal actions
      for (const idx of empty) {
        const pi_a = probs.get(idx) ?? 0
        const grad = idx === action ? (1 - pi_a) : (-pi_a)
        const delta = this.alpha * G_t * grad
        theta[idx] += delta
        totalDelta += Math.abs(delta)
      }
    }

    return totalDelta / traj.length
  }

  decayEpsilon() {
    this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay)
  }

  toJSON() {
    return this.qtable
  }

  loadQTable(qtable) {
    this.qtable = qtable && typeof qtable === 'object' ? qtable : {}
  }

  explainBoard(board) {
    const theta = this.getQValues(board)
    const empty = new Set(getEmptyCells(board))
    return Array.from({ length: 9 }, (_, i) => empty.has(i) ? theta[i] : null)
  }
}
