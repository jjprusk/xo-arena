/**
 * Monte Carlo control engine (every-visit MC) for XO Arena.
 *
 * Instead of bootstrapping like TD methods, MC waits until the end of
 * an episode, then propagates the actual discounted returns backward
 * through all visited (state, action) pairs.
 *
 * Update rule (every-visit, incremental alpha):
 *   G ← cumulative return at each step
 *   Q(s,a) ← Q(s,a) + α [ G − Q(s,a) ]
 */

import { getEmptyCells } from './gameLogic.js'
import { DEFAULT_CONFIG, decayEpsilonValue } from './qLearning.js'

export class MonteCarloEngine {
  constructor(config = {}) {
    this.learningRate   = config.learningRate   ?? DEFAULT_CONFIG.learningRate
    this.discountFactor = config.discountFactor ?? DEFAULT_CONFIG.discountFactor
    this.epsilonDecay   = config.epsilonDecay   ?? DEFAULT_CONFIG.epsilonDecay
    this.epsilonMin     = config.epsilonMin     ?? DEFAULT_CONFIG.epsilonMin
    this.decayMethod    = config.decayMethod    ?? DEFAULT_CONFIG.decayMethod
    this.epsilon = config.currentEpsilon ?? config.epsilonStart ?? DEFAULT_CONFIG.epsilonStart
    this._epsilonSessionStart = this.epsilon
    this._decayEpisode        = 0
    this._decayTotal          = config.totalEpisodes ?? null
    /** @type {Object.<string, number[]>} state key → [q0..q8] */
    this.qtable = {}
    /** Trajectory for the current episode: [{board, action}, ...] */
    this._trajectory = []
  }

  /** Convert board array to a compact string key. */
  stateKey(board) {
    return board.map(c => c ?? '.').join('')
  }

  /** Return (initialising if needed) the 9-element Q-value array for a state. */
  getQValues(board) {
    const key = this.stateKey(board)
    if (!this.qtable[key]) this.qtable[key] = Array(9).fill(0)
    return this.qtable[key]
  }

  /**
   * Choose an action using ε-greedy policy.
   * @param {Array} board
   * @param {boolean} explore
   * @returns {number} cell index
   */
  chooseAction(board, explore = true) {
    const empty = getEmptyCells(board)
    if (empty.length === 0) return -1
    if (explore && Math.random() < this.epsilon) {
      return empty[Math.floor(Math.random() * empty.length)]
    }
    const qvals = this.getQValues(board)
    return empty.reduce((best, idx) => qvals[idx] > qvals[best] ? idx : best, empty[0])
  }

  /**
   * Record a step in the current episode trajectory.
   * Call this after each action the ML agent takes.
   *
   * @param {Array}  state  board before the action (copy it before mutating)
   * @param {number} action action taken
   */
  recordStep(state, action) {
    this._trajectory.push({ board: [...state], action })
  }

  /**
   * Finish the episode: propagate returns backward and update Q-table.
   * Clears the trajectory for the next episode.
   *
   * @param {number} finalReward reward at episode end (+1 win, -1 loss, 0.5 draw)
   * @returns {number} average absolute TD error across all updates
   */
  finishEpisode(finalReward) {
    const traj = this._trajectory
    this._trajectory = []

    if (traj.length === 0) return 0

    let G = finalReward
    let totalDelta = 0

    // Propagate backward through the trajectory
    for (let t = traj.length - 1; t >= 0; t--) {
      const { board, action } = traj[t]
      const qvals = this.getQValues(board)
      const oldQ  = qvals[action]
      qvals[action] += this.learningRate * (G - oldQ)
      totalDelta += Math.abs(qvals[action] - oldQ)
      // Discount for each step further back (every-visit MC with γ)
      G = this.discountFactor * G
    }

    return totalDelta / traj.length
  }

  decayEpsilon() {
    this._decayEpisode++
    this.epsilon = decayEpsilonValue(
      this.epsilon, this.epsilonMin, this._epsilonSessionStart,
      this.decayMethod, this.epsilonDecay, this._decayEpisode, this._decayTotal,
    )
  }

  get stateCount() {
    return Object.keys(this.qtable).length
  }

  toJSON() {
    return this.qtable
  }

  loadQTable(qtable) {
    this.qtable = qtable && typeof qtable === 'object' ? qtable : {}
  }

  explainBoard(board) {
    const qvals = this.getQValues(board)
    const empty = new Set(getEmptyCells(board))
    return Array.from({ length: 9 }, (_, i) => empty.has(i) ? qvals[i] : null)
  }
}
