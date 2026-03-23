/**
 * Frontend ML inference
 *
 * Downloads model weights from the backend once and caches them in memory.
 * All subsequent move selections run locally with zero network latency.
 *
 * Tabular algorithms  (Q_LEARNING, SARSA, MONTE_CARLO, POLICY_GRADIENT):
 *   Pure Q-table dictionary lookup.
 *
 * DQN:
 *   Online Q-network forward pass → argmax over legal moves.
 *
 * AlphaZero:
 *   Full MCTS with PUCT scoring, policy network priors, and value network
 *   evaluation — exact port of the backend implementation.
 */

// ─── NeuralNet (forward + fromJSON only — no training) ───────────────────────

class NeuralNet {
  constructor(layerSizes, weights, biases) {
    this.layerSizes = layerSizes
    this.weights    = weights
    this.biases     = biases
  }

  forward(input) {
    const L = this.layerSizes.length
    const activations = [input.slice()]
    for (let l = 0; l < L - 1; l++) {
      const fanOut = this.layerSizes[l + 1]
      const prev   = activations[l]
      const W      = this.weights[l]
      const b      = this.biases[l]
      const isLast = l === L - 2
      const next   = new Array(fanOut)
      for (let j = 0; j < fanOut; j++) {
        let z = b[j]
        const wRow = W[j]
        for (let i = 0; i < prev.length; i++) z += wRow[i] * prev[i]
        next[j] = isLast ? z : Math.max(0, z)
      }
      activations.push(next)
    }
    return activations[activations.length - 1]
  }

  static fromJSON({ layerSizes, weights, biases }) {
    const L = layerSizes.length
    const W = []
    for (let l = 0; l < L - 1; l++) {
      const fanIn  = layerSizes[l]
      const fanOut = layerSizes[l + 1]
      const flat   = weights[l]
      const layer  = []
      for (let j = 0; j < fanOut; j++) layer.push(flat.slice(j * fanIn, (j + 1) * fanIn))
      W.push(layer)
    }
    return new NeuralNet(layerSizes, W, biases.map(b => b.slice()))
  }
}

// ─── Game logic helpers ──────────────────────────────────────────────────────

const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
]

function getWinner(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a]
  }
  return null
}

function getEmptyCells(board) {
  return board.map((c, i) => (c === null ? i : null)).filter(i => i !== null)
}

function opponent(mark) {
  return mark === 'X' ? 'O' : 'X'
}

// ─── Math helpers ────────────────────────────────────────────────────────────

function encodeBoard(board, mark) {
  const opp = opponent(mark)
  return board.map(c => (c === mark ? 1 : c === opp ? -1 : 0))
}

function maskedSoftmax(output, legalIndices) {
  const vals = legalIndices.map(i => output[i])
  const max  = Math.max(...vals)
  const exps = vals.map(v => Math.exp(v - max))
  const sum  = exps.reduce((s, v) => s + v, 0)
  const result = new Array(output.length).fill(0)
  legalIndices.forEach((i, k) => {
    result[i] = sum > 0 ? exps[k] / sum : 1 / legalIndices.length
  })
  return result
}

function tanh(x) {
  const cx = Math.max(-20, Math.min(20, x))
  const ep = Math.exp(2 * cx)
  return (ep - 1) / (ep + 1)
}

// ─── MCTS ────────────────────────────────────────────────────────────────────

function createNode(board, mark, priorProb) {
  return { board, mark, visits: 0, value: 0, children: {}, priorProb }
}

function expandNode(node, policyNet) {
  const empty  = getEmptyCells(node.board)
  if (empty.length === 0) return
  const priors = maskedSoftmax(policyNet.forward(encodeBoard(node.board, node.mark)), empty)
  for (const action of empty) {
    const nextBoard = [...node.board]
    nextBoard[action] = node.mark
    node.children[action] = createNode(nextBoard, opponent(node.mark), priors[action])
  }
}

function simulate(root, policyNet, valueNet, cPuct) {
  let node = root
  const path = [node]

  // Selection — traverse using PUCT until unvisited leaf
  while (Object.keys(node.children).length > 0) {
    const totalVisits = node.visits
    let bestScore = -Infinity
    let bestAction = null
    for (const [action, child] of Object.entries(node.children)) {
      const q    = child.visits > 0 ? child.value / child.visits : 0
      const puct = q + cPuct * child.priorProb * Math.sqrt(totalVisits) / (1 + child.visits)
      if (puct > bestScore) { bestScore = puct; bestAction = action }
    }
    node = node.children[bestAction]
    path.push(node)
    if (node.visits === 0) break
  }

  // Evaluate leaf
  const winner = getWinner(node.board)
  const empty  = getEmptyCells(node.board)

  let value
  if (winner) {
    value = winner === root.mark ? 1 : -1
  } else if (empty.length === 0) {
    value = 0
  } else {
    if (Object.keys(node.children).length === 0 && node.visits > 0) {
      expandNode(node, policyNet)
    }
    value = tanh(valueNet.forward(encodeBoard(node.board, node.mark))[0])
  }

  // Backpropagation
  for (let i = path.length - 1; i >= 0; i--) {
    path[i].visits++
    path[i].value += (path.length - 1 - i) % 2 === 0 ? value : -value
  }
}

function selectByVisits(root) {
  // Greedy: pick the action with most visits (deterministic for gameplay)
  const entries = Object.entries(root.children)
  if (entries.length === 0) return -1
  return parseInt(entries.reduce((a, b) => b[1].visits > a[1].visits ? b : a)[0])
}

// ─── Per-algorithm inference ─────────────────────────────────────────────────

function inferTabular(qtable, board) {
  const key   = board.map(c => c ?? '.').join('')
  const qvals = qtable[key] ?? new Array(9).fill(0)
  const empty = getEmptyCells(board)
  if (empty.length === 0) return -1
  return empty.reduce((best, idx) => (qvals[idx] > qvals[best] ? idx : best), empty[0])
}

function inferDQN(net, board, mark) {
  const empty = getEmptyCells(board)
  if (empty.length === 0) return -1
  const qvals = net.forward(encodeBoard(board, mark))
  return empty.reduce((best, idx) => (qvals[idx] > qvals[best] ? idx : best), empty[0])
}

function inferAlphaZero(policyNet, valueNet, board, mark, numSimulations, cPuct) {
  const empty = getEmptyCells(board)
  if (empty.length === 0) return -1
  if (empty.length === 1) return empty[0]

  const root = createNode(board, mark, 0)
  expandNode(root, policyNet)

  for (let i = 0; i < numSimulations; i++) {
    simulate(root, policyNet, valueNet, cPuct)
  }

  return selectByVisits(root)
}

// ─── Cache ───────────────────────────────────────────────────────────────────

const modelCache   = new Map()
const pendingLoads = new Map()

function parseModel(data) {
  const { algorithm, qtable, config = {} } = data
  switch (algorithm) {
    case 'Q_LEARNING':
    case 'SARSA':
    case 'MONTE_CARLO':
    case 'POLICY_GRADIENT':
      return qtable ? { type: 'tabular', qtable } : null

    case 'DQN':
      return qtable?.online
        ? { type: 'dqn', net: NeuralNet.fromJSON(qtable.online) }
        : null

    case 'ALPHA_ZERO':
      return (qtable?.policyNet && qtable?.valueNet)
        ? {
            type: 'alphazero',
            policyNet:      NeuralNet.fromJSON(qtable.policyNet),
            valueNet:       NeuralNet.fromJSON(qtable.valueNet),
            numSimulations: config.numSimulations ?? 50,
            cPuct:          config.cPuct          ?? 1.5,
          }
        : null

    default:
      return null
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Download and cache a model. Safe to call multiple times.
 * @param {string}   modelId
 * @param {function} fetchFn  api.ml.exportModel
 * @returns {Promise<boolean>}
 */
export async function loadModel(modelId, fetchFn) {
  if (modelCache.has(modelId)) return true
  if (pendingLoads.has(modelId)) return pendingLoads.get(modelId)

  const promise = fetchFn(modelId)
    .then(data => {
      const engine = parseModel(data)
      if (engine) { modelCache.set(modelId, engine); return true }
      return false
    })
    .catch(() => false)
    .finally(() => pendingLoads.delete(modelId))

  pendingLoads.set(modelId, promise)
  return promise
}

/**
 * Get the best move using the locally cached model.
 * Returns null if the model is not cached.
 *
 * @param {string} modelId
 * @param {Array}  board   9-element array of 'X' | 'O' | null
 * @param {string} mark    'X' or 'O'
 * @returns {number|null}
 */
export function getLocalMove(modelId, board, mark = 'X') {
  const engine = modelCache.get(modelId)
  if (!engine) return null

  switch (engine.type) {
    case 'tabular':
      return inferTabular(engine.qtable, board)
    case 'dqn':
      return inferDQN(engine.net, board, mark)
    case 'alphazero':
      return inferAlphaZero(
        engine.policyNet, engine.valueNet,
        board, mark,
        engine.numSimulations, engine.cPuct,
      )
    default:
      return null
  }
}

export function isModelCached(modelId) { return modelCache.has(modelId) }

export function evictModel(modelId) { modelCache.delete(modelId) }
