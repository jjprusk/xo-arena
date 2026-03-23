/**
 * Frontend ML inference
 *
 * Downloads model weights from the backend once and caches them in memory.
 * All subsequent move selections run locally with zero network latency.
 *
 * Tabular algorithms  (Q_LEARNING, SARSA, MONTE_CARLO, POLICY_GRADIENT):
 *   Pure Q-table dictionary lookup.
 *
 * Neural algorithms   (DQN, ALPHA_ZERO):
 *   Pure-JS forward pass — same math as the backend, no TensorFlow needed.
 *   AlphaZero uses the policy network only (no MCTS), which is slightly weaker
 *   than the full backend implementation but runs instantly in the browser.
 */

// ─── Minimal NeuralNet (forward + fromJSON only, no training) ────────────────

class NeuralNet {
  constructor(layerSizes, weights, biases) {
    this.layerSizes = layerSizes
    this.weights    = weights   // weights[l][j][i]
    this.biases     = biases    // biases[l][j]
  }

  forward(input) {
    const L = this.layerSizes.length
    const activations = [input.slice()]
    for (let l = 0; l < L - 1; l++) {
      const fanOut = this.layerSizes[l + 1]
      const prev = activations[l]
      const W = this.weights[l]
      const b = this.biases[l]
      const isLast = l === L - 2
      const next = new Array(fanOut)
      for (let j = 0; j < fanOut; j++) {
        let z = b[j]
        const wRow = W[j]
        for (let i = 0; i < prev.length; i++) z += wRow[i] * prev[i]
        next[j] = isLast ? z : Math.max(0, z)   // linear out, ReLU hidden
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getEmptyCells(board) {
  return board.map((c, i) => (c === null ? i : null)).filter(i => i !== null)
}

function encodeBoard(board, mark) {
  const opp = mark === 'X' ? 'O' : 'X'
  return board.map(c => (c === mark ? 1 : c === opp ? -1 : 0))
}

function maskedSoftmax(output, legalIndices) {
  const vals = legalIndices.map(i => output[i])
  const max  = Math.max(...vals)
  const exps = vals.map(v => Math.exp(v - max))
  const sum  = exps.reduce((s, v) => s + v, 0)
  const result = new Array(output.length).fill(0)
  legalIndices.forEach((i, k) => { result[i] = sum > 0 ? exps[k] / sum : 1 / legalIndices.length })
  return result
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
  const empty  = getEmptyCells(board)
  if (empty.length === 0) return -1
  const qvals  = net.forward(encodeBoard(board, mark))
  return empty.reduce((best, idx) => (qvals[idx] > qvals[best] ? idx : best), empty[0])
}

function inferAlphaZero(policyNet, board, mark) {
  const empty  = getEmptyCells(board)
  if (empty.length === 0) return -1
  const raw    = policyNet.forward(encodeBoard(board, mark))
  const probs  = maskedSoftmax(raw, empty)
  return empty.reduce((best, idx) => (probs[idx] > probs[best] ? idx : best), empty[0])
}

// ─── Cache ───────────────────────────────────────────────────────────────────

// modelId → parsed engine ready for inference
const modelCache = new Map()

// modelId → Promise (prevents duplicate in-flight fetches)
const pendingLoads = new Map()

function parseModel(data) {
  const { algorithm, qtable } = data
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
      return qtable?.policyNet
        ? { type: 'alphazero', policyNet: NeuralNet.fromJSON(qtable.policyNet) }
        : null

    default:
      return null
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Download and cache a model. Safe to call multiple times — deduplicates
 * in-flight requests and is a no-op if already cached.
 *
 * @param {string}   modelId
 * @param {function} fetchFn  api.ml.exportModel — (id) => Promise<model>
 * @returns {Promise<boolean>} true if the model is available locally
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
 * Returns null if the model is not cached (caller should fall back to API).
 *
 * @param {string} modelId
 * @param {Array}  board   9-element array of 'X' | 'O' | null
 * @param {string} mark    'X' or 'O' (required for neural models)
 * @returns {number|null}  cell index 0–8, or null if not in cache
 */
export function getLocalMove(modelId, board, mark = 'X') {
  const engine = modelCache.get(modelId)
  if (!engine) return null

  switch (engine.type) {
    case 'tabular':   return inferTabular(engine.qtable, board)
    case 'dqn':       return inferDQN(engine.net, board, mark)
    case 'alphazero': return inferAlphaZero(engine.policyNet, board, mark)
    default:          return null
  }
}

/**
 * Returns true if the model is in the local cache.
 */
export function isModelCached(modelId) {
  return modelCache.has(modelId)
}

/**
 * Evict a model from the cache (call after training so stale weights
 * are not used for the next game).
 */
export function evictModel(modelId) {
  modelCache.delete(modelId)
}
