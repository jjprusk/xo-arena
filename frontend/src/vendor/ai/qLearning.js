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
  decayMethod: 'exponential',  // 'exponential' | 'linear' | 'cosine'
}

/**
 * Compute the next epsilon value.
 *
 * - exponential: ε *= decayRate  (default; decayRate drives the schedule)
 * - linear:      ε decreases linearly from sessionStart → epsilonMin over totalEpisodes
 * - cosine:      ε follows a half-cosine curve from sessionStart → epsilonMin
 *
 * @param {number} eps           current epsilon
 * @param {number} epsilonMin    floor
 * @param {number} sessionStart  epsilon at the beginning of this training session
 * @param {string} method        decay method
 * @param {number} decayRate     multiplier (exponential only)
 * @param {number} episode       episodes completed so far this session (1-based)
 * @param {number|null} total    total episodes in this session (needed for linear/cosine)
 */
export function decayEpsilonValue(eps, epsilonMin, sessionStart, method, decayRate, episode, total) {
  if (method === 'linear' && total > 0) {
    return Math.max(epsilonMin, sessionStart - (sessionStart - epsilonMin) * (episode / total))
  }
  if (method === 'cosine' && total > 0) {
    const ratio = Math.min(1, episode / total)
    return epsilonMin + 0.5 * (sessionStart - epsilonMin) * (1 + Math.cos(Math.PI * ratio))
  }
  // exponential (default — also the fallback when total is unknown)
  return Math.max(epsilonMin, eps * decayRate)
}

export class QLearningEngine {
  constructor(config = {}) {
    this.learningRate   = config.learningRate   ?? DEFAULT_CONFIG.learningRate
    this.discountFactor = config.discountFactor ?? DEFAULT_CONFIG.discountFactor
    this.epsilonDecay   = config.epsilonDecay   ?? DEFAULT_CONFIG.epsilonDecay
    this.epsilonMin     = config.epsilonMin     ?? DEFAULT_CONFIG.epsilonMin
    this.decayMethod    = config.decayMethod    ?? DEFAULT_CONFIG.decayMethod
    // currentEpsilon is persisted across sessions; fall back to epsilonStart on first use
    this.epsilon = config.currentEpsilon ?? config.epsilonStart ?? DEFAULT_CONFIG.epsilonStart
    // Track session-level decay progress for linear/cosine schedules
    this._epsilonSessionStart = this.epsilon
    this._decayEpisode        = 0
    this._decayTotal          = config.totalEpisodes ?? null
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
    this._decayEpisode++
    this.epsilon = decayEpsilonValue(
      this.epsilon, this.epsilonMin, this._epsilonSessionStart,
      this.decayMethod, this.epsilonDecay, this._decayEpisode, this._decayTotal,
    )
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
/**
 * Run a single training episode using proper TD Q-learning.
 *
 * Each player's Q-value is updated after seeing the opponent's response
 * (deferred one full turn), so the "next state" is the board two half-moves
 * later — the next position where this player will act.  Terminal moves are
 * updated immediately with the final reward.
 */
export function runEpisode(engine, mlMark, opponentFn) {
  const board = Array(9).fill(null)
  let currentPlayer = 'X'
  let totalMoves = 0
  let totalQDelta = 0
  let qdeltaCount = 0

  // Deferred update: after the opponent responds we know the "next state"
  // for the current player's last move.
  const pending = { X: null, O: null }  // { board, action }

  const applyUpdate = (mark, nextBoard, reward) => {
    if (!pending[mark]) return
    const { board: s, action: a } = pending[mark]
    const delta = engine.updateQ(s, a, reward, nextBoard)
    totalQDelta += delta
    qdeltaCount++
    pending[mark] = null
  }

  while (true) {
    const isML = mlMark === 'both' || currentPlayer === mlMark
    const prevBoard = [...board]
    const action = isML
      ? engine.chooseAction(board, true)
      : opponentFn(board, currentPlayer)

    board[action] = currentPlayer
    totalMoves++

    const winner = getWinner(board)
    const isDraw = !winner && isBoardFull(board)

    if (winner || isDraw) {
      const termRewards = isDraw
        ? { X: 0.5, O: 0.5 }
        : { X: winner === 'X' ? 1.0 : -1.0, O: winner === 'O' ? 1.0 : -1.0 }

      const marksToUpdate = mlMark === 'both' ? ['X', 'O'] : [mlMark]

      // Update the move that just ended the game
      if (marksToUpdate.includes(currentPlayer)) {
        const delta = engine.updateQ(prevBoard, action, termRewards[currentPlayer], board)
        totalQDelta += delta
        qdeltaCount++
      }

      // Flush the opponent's pending deferred update with the terminal reward
      const opp = opponent(currentPlayer)
      if (marksToUpdate.includes(opp)) {
        applyUpdate(opp, board, termRewards[opp])
      }

      engine.decayEpsilon()

      let outcome
      if (isDraw) {
        outcome = 'DRAW'
      } else if (mlMark === 'both') {
        outcome = winner === 'X' ? 'WIN' : 'LOSS'
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

    // Non-terminal: now that the opponent has just seen currentPlayer's move,
    // apply the deferred update for the opponent's previous action.
    // "next state" for the opponent's last action = current board (after currentPlayer moved).
    const opp = opponent(currentPlayer)
    if (mlMark === 'both' || opp === mlMark) {
      applyUpdate(opp, board, 0)
    }

    // Store this move as pending — will be updated next time currentPlayer acts
    if (mlMark === 'both' || currentPlayer === mlMark) {
      pending[currentPlayer] = { board: prevBoard, action }
    }

    currentPlayer = opp
  }
}
