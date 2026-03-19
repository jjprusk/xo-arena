/**
 * Q-Learning engine for XO Arena.
 *
 * State: board serialised as a 9-char string ('X', 'O', or '.' for empty).
 * Action: cell index 0–8 (legal moves only).
 * Reward: win = +1.0, loss = −1.0, draw = +0.5, per-step = 0.
 *
 * Update rule:
 *   Q(s,a) ← Q(s,a) + α [ r + γ·max_a' Q(s',a') − Q(s,a) ]
 */

import { getWinner, isBoardFull, getEmptyCells, opponent } from './gameLogic.js'

export const DEFAULT_CONFIG = {
  learningRate: 0.3,
  discountFactor: 0.9,
  epsilonStart: 1.0,
  epsilonDecay: 0.995,
  epsilonMin: 0.05,
}

export class QLearningEngine {
  constructor(config = {}) {
    this.learningRate   = config.learningRate   ?? DEFAULT_CONFIG.learningRate
    this.discountFactor = config.discountFactor ?? DEFAULT_CONFIG.discountFactor
    this.epsilonDecay   = config.epsilonDecay   ?? DEFAULT_CONFIG.epsilonDecay
    this.epsilonMin     = config.epsilonMin     ?? DEFAULT_CONFIG.epsilonMin
    // currentEpsilon is persisted across sessions; fall back to epsilonStart on first use
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
   * @param {boolean} explore - false for pure exploitation (real games)
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
   * Update Q(s,a) and return the absolute delta (used as convergence metric).
   */
  updateQ(board, action, reward, nextBoard) {
    const qvals    = this.getQValues(board)
    const nextEmpty = getEmptyCells(nextBoard)
    let maxNextQ = 0
    if (nextEmpty.length > 0) {
      const nextQvals = this.getQValues(nextBoard)
      maxNextQ = Math.max(...nextEmpty.map(i => nextQvals[i]))
    }
    const oldQ = qvals[action]
    qvals[action] += this.learningRate * (reward + this.discountFactor * maxNextQ - oldQ)
    return Math.abs(qvals[action] - oldQ)
  }

  decayEpsilon() {
    this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay)
  }

  /** Number of distinct states seen so far. */
  get stateCount() {
    return Object.keys(this.qtable).length
  }

  /** Serialise Q-table for DB storage. */
  toJSON() {
    return this.qtable
  }

  /** Restore Q-table from DB value. */
  loadQTable(qtable) {
    this.qtable = qtable && typeof qtable === 'object' ? qtable : {}
  }

  /**
   * For a given board, return Q-values for all 9 cells (null = illegal move).
   * Used by the explainability endpoint.
   */
  explainBoard(board) {
    const qvals = this.getQValues(board)
    const empty = new Set(getEmptyCells(board))
    return Array.from({ length: 9 }, (_, i) => empty.has(i) ? qvals[i] : null)
  }
}

/**
 * Run a single training episode.
 *
 * @param {QLearningEngine} engine
 * @param {'both'|'X'|'O'} mlMark - 'both' for self-play
 * @param {Function|null} opponentFn - (board, player) => cellIndex, null for self-play
 * @returns {{ outcome: string, totalMoves: number, avgQDelta: number, epsilon: number }}
 */
export function runEpisode(engine, mlMark, opponentFn) {
  const board = Array(9).fill(null)
  let currentPlayer = 'X'
  let totalMoves = 0
  let totalQDelta = 0
  let qdeltaCount = 0
  const history = { X: [], O: [] }

  while (true) {
    const isML = mlMark === 'both' || currentPlayer === mlMark
    const action = isML
      ? engine.chooseAction(board, true)
      : opponentFn(board, currentPlayer)

    const prevBoard = [...board]
    board[action] = currentPlayer
    totalMoves++
    history[currentPlayer].push({ board: prevBoard, action })

    const winner  = getWinner(board)
    const isDraw  = !winner && isBoardFull(board)

    if (winner || isDraw) {
      const rewards = winner === 'X'
        ? { X: 1.0, O: -1.0 }
        : winner === 'O'
          ? { X: -1.0, O: 1.0 }
          : { X: 0.5, O: 0.5 }

      const marksToUpdate = mlMark === 'both' ? ['X', 'O'] : [mlMark]
      for (const mark of marksToUpdate) {
        for (const { board: s, action: a } of history[mark]) {
          const delta = engine.updateQ(s, a, rewards[mark], board)
          totalQDelta += delta
          qdeltaCount++
        }
      }
      engine.decayEpsilon()

      let outcome
      if (isDraw) {
        outcome = 'DRAW'
      } else if (mlMark === 'both') {
        outcome = winner === 'X' ? 'WIN' : 'LOSS'  // track from X perspective in self-play
      } else {
        outcome = winner === mlMark ? 'WIN' : 'LOSS'
      }

      return {
        outcome,
        totalMoves,
        avgQDelta: qdeltaCount > 0 ? totalQDelta / qdeltaCount : 0,
        epsilon: engine.epsilon,
      }
    }

    currentPlayer = opponent(currentPlayer)
  }
}
