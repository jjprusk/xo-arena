/**
 * SARSA (on-policy TD control) engine for XO Arena.
 *
 * Update rule:
 *   Q(s,a) ← Q(s,a) + α [ r + γ·Q(s',a') − Q(s,a) ]
 *
 * Unlike Q-Learning, the next action a' is the actual action chosen
 * (on-policy), not the greedy max action.
 */

import { getEmptyCells } from './gameLogic.js'
import { DEFAULT_CONFIG } from './qLearning.js'

export class SarsaEngine {
  constructor(config = {}) {
    this.learningRate   = config.learningRate   ?? DEFAULT_CONFIG.learningRate
    this.discountFactor = config.discountFactor ?? DEFAULT_CONFIG.discountFactor
    this.epsilonDecay   = config.epsilonDecay   ?? DEFAULT_CONFIG.epsilonDecay
    this.epsilonMin     = config.epsilonMin     ?? DEFAULT_CONFIG.epsilonMin
    this.epsilon = config.currentEpsilon ?? config.epsilonStart ?? DEFAULT_CONFIG.epsilonStart
    /** @type {Object.<string, number[]>} state key → [q0..q8] */
    this.qtable = {}
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
   * @param {boolean} explore - false for pure exploitation
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
   * SARSA update: uses the actual next action (not max).
   *
   * Q(s,a) ← Q(s,a) + α [ r + γ·Q(s',a') − Q(s,a) ]
   *
   * @param {Array}   board       current board (s)
   * @param {number}  action      action taken (a)
   * @param {number}  reward      reward received
   * @param {Array}   nextBoard   next board (s')
   * @param {number}  nextAction  actual next action chosen (a') — SARSA key diff from Q-Learning
   * @param {boolean} done        whether the episode ended
   * @returns {number} absolute TD error
   */
  update(board, action, reward, nextBoard, nextAction, done) {
    const qvals  = this.getQValues(board)
    let nextQ = 0
    if (!done && nextAction >= 0) {
      const nextQvals = this.getQValues(nextBoard)
      nextQ = nextQvals[nextAction]
    }
    const oldQ = qvals[action]
    qvals[action] += this.learningRate * (reward + this.discountFactor * nextQ - oldQ)
    return Math.abs(qvals[action] - oldQ)
  }

  decayEpsilon() {
    this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay)
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
