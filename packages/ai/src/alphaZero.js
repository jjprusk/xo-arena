/**
 * AlphaZero-style engine for XO Arena.
 *
 * Uses two networks:
 *   - Policy network  [9, 64, 32, 9]  with softmax output (illegal moves masked)
 *   - Value  network  [9, 64, 32, 1]  with tanh output (range -1 to 1)
 *
 * MCTS uses PUCT scoring. runEpisode() performs self-play and trains both nets.
 */

import { NeuralNet } from './neuralNet.js'
import { getWinner, isBoardFull, getEmptyCells, opponent } from './gameLogic.js'

const POLICY_LAYERS = [9, 64, 32, 9]
const VALUE_LAYERS  = [9, 64, 32, 1]

export class AlphaZeroEngine {
  constructor(config = {}) {
    this.numSimulations = config.numSimulations ?? 50
    this.cPuct          = config.cPuct          ?? 1.5
    this.alpha          = config.alpha          ?? 0.001
    this.gamma          = config.gamma          ?? 0.99
    this.temperature    = config.temperature    ?? 1.0

    this._policyNet = new NeuralNet(POLICY_LAYERS)
    this._valueNet  = new NeuralNet(VALUE_LAYERS)
  }

  // ─── Interface ──────────────────────────────────────────────────────────────

  get epsilon() { return 0 }
  get stateCount() { return 0 }

  /**
   * Choose an action via MCTS.
   * @param {Array} board
   * @param {string} mark
   * @returns {number} cell index
   */
  chooseAction(board, mark) {
    const empty = getEmptyCells(board)
    if (empty.length === 0) return -1
    if (empty.length === 1) return empty[0]

    const root = _createNode(board, mark, null, 0, null)
    _expandNode(root, this._policyNet)

    for (let i = 0; i < this.numSimulations; i++) {
      this._simulate(root)
    }

    // Select action by visit count (temperature-weighted if temp > 0)
    return _selectActionFromVisits(root, this.temperature)
  }

  /**
   * Run one self-play episode, collect training data, and train both nets.
   * @returns {{ outcome: string, totalMoves: number, avgQDelta: number, epsilon: number }}
   */
  runEpisode() {
    const board = Array(9).fill(null)
    let currentMark = 'X'
    const examples = [] // { input, policyTarget, valueTarget }

    while (true) {
      const empty = getEmptyCells(board)
      if (empty.length === 0 || getWinner(board)) break

      // Run MCTS from current position
      const root = _createNode([...board], currentMark, null, 0, null)
      _expandNode(root, this._policyNet)

      for (let i = 0; i < this.numSimulations; i++) {
        this._simulate(root)
      }

      // Policy target: visit count distribution
      const totalVisits = Object.values(root.children).reduce((s, c) => s + c.visits, 0)
      const policyTarget = new Array(9).fill(0)
      for (const [action, child] of Object.entries(root.children)) {
        policyTarget[parseInt(action)] = totalVisits > 0 ? child.visits / totalVisits : 0
      }

      const input = _encodeBoard(board, currentMark)
      examples.push({ input, policyTarget, mark: currentMark })

      // Play best move
      const action = _selectActionFromVisits(root, this.temperature)
      board[action] = currentMark
      currentMark = opponent(currentMark)
    }

    // Assign value targets based on final outcome
    const winner = getWinner(board)
    for (const ex of examples) {
      if (!winner) {
        ex.valueTarget = 0          // draw
      } else {
        ex.valueTarget = winner === ex.mark ? 1 : -1
      }
    }

    // Train both networks on the collected examples
    for (const { input, policyTarget, valueTarget } of examples) {
      this._trainStep(input, policyTarget, valueTarget)
    }

    const outcome = !winner ? 'DRAW' : winner === 'X' ? 'WIN' : 'LOSS'
    return { outcome, totalMoves: 9 - getEmptyCells(board).length, avgQDelta: 0, epsilon: 0 }
  }

  // ─── Checkpoint compatibility ────────────────────────────────────────────────

  getQTable() {
    return {
      policyNet: this._policyNet.serialize(),
      valueNet:  this._valueNet.serialize(),
    }
  }

  toJSON() {
    return this.getQTable()
  }

  loadQTable(data) {
    if (!data || typeof data !== 'object') return
    try {
      if (data.policyNet) this._policyNet = NeuralNet.fromJSON(data.policyNet)
      if (data.valueNet)  this._valueNet  = NeuralNet.fromJSON(data.valueNet)
    } catch (_) {
      // Ignore corrupt data gracefully
    }
  }

  /**
   * Run a forward pass through both nets for explainability.
   */
  explainBoard(board, mark = 'X') {
    const input = _encodeBoard(board, mark)
    const { output: policyOutput, activations: policyActs } = this._policyNet.forward(input)
    const { output: valueOutput } = this._valueNet.forward(input)

    const empty = new Set(getEmptyCells(board))
    const maskedPolicy = policyOutput.map((v, i) => empty.has(i) ? v : -Infinity)
    const softmaxed    = _softmax(maskedPolicy.map((v, i) => empty.has(i) ? v : 0), [...empty])
    const qValues      = Array.from({ length: 9 }, (_, i) => empty.has(i) ? softmaxed[i] : null)

    return { qValues, activations: policyActs, value: valueOutput[0] }
  }

  // ─── MCTS ───────────────────────────────────────────────────────────────────

  _simulate(root) {
    // Selection: traverse down using PUCT until leaf
    let node = root
    const path = [node]

    while (Object.keys(node.children).length > 0) {
      const totalVisits = node.visits
      let bestScore = -Infinity
      let bestAction = null

      for (const [action, child] of Object.entries(node.children)) {
        const q     = child.visits > 0 ? child.value / child.visits : 0
        const puct  = q + this.cPuct * child.priorProb * Math.sqrt(totalVisits) / (1 + child.visits)
        if (puct > bestScore) {
          bestScore  = puct
          bestAction = action
        }
      }

      node = node.children[bestAction]
      path.push(node)

      if (node.visits === 0) break  // unvisited leaf — expand it
    }

    const leaf = node

    // Check terminal
    const winner = getWinner(leaf.board)
    const empty  = getEmptyCells(leaf.board)
    const isDraw = !winner && empty.length === 0

    let value
    if (winner) {
      value = winner === root.mark ? 1 : -1
    } else if (isDraw) {
      value = 0
    } else {
      // Expansion: if leaf hasn't been expanded yet, expand it
      if (Object.keys(leaf.children).length === 0 && leaf.visits > 0) {
        _expandNode(leaf, this._policyNet)
      }
      // Value from value network
      const input = _encodeBoard(leaf.board, leaf.mark)
      const { output } = this._valueNet.forward(input)
      value = _tanh(output[0])  // clamp to [-1,1]
    }

    // Backpropagation
    for (let i = path.length - 1; i >= 0; i--) {
      path[i].visits++
      // Alternate sign perspective
      const perspective = (path.length - 1 - i) % 2 === 0 ? value : -value
      path[i].value += perspective
    }
  }

  // ─── Training ───────────────────────────────────────────────────────────────

  _trainStep(input, policyTarget, valueTarget) {
    // Policy network forward + backward
    const { output: policyOutput, activations: policyActs } = this._policyNet.forward(input)
    const softmaxOut  = _softmaxAll(policyOutput)
    // Cross-entropy gradient: softmax(z) - target
    const policyGrad  = softmaxOut.map((v, i) => v - policyTarget[i])
    this._policyNet.backward(policyGrad, policyActs)
    this._policyNet.update(this.alpha)

    // Value network forward + backward
    const { output: valueOutput, activations: valueActs } = this._valueNet.forward(input)
    const predicted  = _tanh(valueOutput[0])
    // MSE gradient for value net; output is linear, tanh applied after
    const valueGrad  = [2 * (predicted - valueTarget)]
    this._valueNet.backward(valueGrad, valueActs)
    this._valueNet.update(this.alpha)
  }
}

// ─── Node helpers ─────────────────────────────────────────────────────────────

function _createNode(board, mark, parent, priorProb, action) {
  return { board, mark, visits: 0, value: 0, children: {}, priorProb, parent, action }
}

function _expandNode(node, policyNet) {
  const empty = getEmptyCells(node.board)
  if (empty.length === 0) return

  const input  = _encodeBoard(node.board, node.mark)
  const { output } = policyNet.forward(input)
  const priors = _softmax(output, empty)

  for (const action of empty) {
    const nextBoard = [...node.board]
    nextBoard[action] = node.mark
    const child = _createNode(nextBoard, opponent(node.mark), node, priors[action], action)
    node.children[action] = child
  }
}

function _selectActionFromVisits(root, temperature) {
  const children = Object.entries(root.children)
  if (children.length === 0) return -1

  if (temperature < 0.01) {
    // Greedy: argmax visits
    return parseInt(children.reduce((a, b) => b[1].visits > a[1].visits ? b : a)[0])
  }

  // Temperature-weighted sample
  const visits = children.map(([, c]) => Math.pow(c.visits, 1 / temperature))
  const total  = visits.reduce((s, v) => s + v, 0)
  if (total === 0) return parseInt(children[0][0])

  let r = Math.random() * total
  for (let i = 0; i < children.length; i++) {
    r -= visits[i]
    if (r <= 0) return parseInt(children[i][0])
  }
  return parseInt(children[children.length - 1][0])
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function _encodeBoard(board, mark) {
  const opp = mark === 'X' ? 'O' : 'X'
  return board.map(c => c === mark ? 1 : c === opp ? -1 : 0)
}

/**
 * Softmax over a subset of indices (for masking illegal moves).
 * Returns full 9-length array where illegal moves = 0.
 */
function _softmax(output, legalIndices) {
  const vals   = legalIndices.map(i => output[i])
  const maxVal = Math.max(...vals)
  const exps   = vals.map(v => Math.exp(v - maxVal))
  const sum    = exps.reduce((s, v) => s + v, 0)
  const result = new Array(output.length).fill(0)
  legalIndices.forEach((i, k) => { result[i] = sum > 0 ? exps[k] / sum : 1 / legalIndices.length })
  return result
}

/** Full softmax over all outputs (for policy training). */
function _softmaxAll(output) {
  const maxVal = Math.max(...output)
  const exps   = output.map(v => Math.exp(v - maxVal))
  const sum    = exps.reduce((s, v) => s + v, 0)
  return exps.map(v => sum > 0 ? v / sum : 1 / output.length)
}

function _tanh(x) {
  // Clamp to prevent overflow
  const cx = Math.max(-20, Math.min(20, x))
  const ep = Math.exp(2 * cx)
  return (ep - 1) / (ep + 1)
}
