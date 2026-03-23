/**
 * Frontend ML inference — Phase 1
 *
 * Downloads a model's Q-table from the backend once and caches it in memory.
 * All subsequent move selections happen locally with zero network latency.
 *
 * Supported algorithms (tabular, Q-table based):
 *   Q_LEARNING, SARSA, MONTE_CARLO, POLICY_GRADIENT
 *
 * Neural algorithms (DQN, ALPHA_ZERO) fall back to the backend API.
 */

const TABULAR_ALGORITHMS = new Set(['Q_LEARNING', 'SARSA', 'MONTE_CARLO', 'POLICY_GRADIENT'])

// modelId → { algorithm, qtable }
const modelCache = new Map()

// modelId → Promise (prevents duplicate in-flight fetches)
const pendingLoads = new Map()

function stateKey(board) {
  return board.map(c => c ?? '.').join('')
}

function getEmptyCells(board) {
  return board.map((c, i) => (c === null ? i : null)).filter(i => i !== null)
}

function selectMove(qtable, board) {
  const empty = getEmptyCells(board)
  if (empty.length === 0) return -1
  const qvals = qtable[stateKey(board)] ?? Array(9).fill(0)
  return empty.reduce((best, idx) => (qvals[idx] > qvals[best] ? idx : best), empty[0])
}

/**
 * Download and cache a model. Safe to call multiple times — deduplicates
 * in-flight requests and is a no-op if the model is already cached.
 *
 * @param {string} modelId
 * @param {function} fetchFn  api.ml.exportModel — (id) => Promise<model>
 * @returns {Promise<boolean>} true if the model is now available locally
 */
export async function loadModel(modelId, fetchFn) {
  if (modelCache.has(modelId)) return true
  if (pendingLoads.has(modelId)) return pendingLoads.get(modelId)

  const promise = fetchFn(modelId)
    .then(data => {
      if (TABULAR_ALGORITHMS.has(data.algorithm) && data.qtable) {
        modelCache.set(modelId, { algorithm: data.algorithm, qtable: data.qtable })
        return true
      }
      return false // neural net — caller must use backend API
    })
    .catch(() => false)
    .finally(() => pendingLoads.delete(modelId))

  pendingLoads.set(modelId, promise)
  return promise
}

/**
 * Get the best move for a board position using the locally cached model.
 * Returns null if the model is not cached (caller should fall back to API).
 *
 * @param {string} modelId
 * @param {Array}  board  9-element array of 'X' | 'O' | null
 * @returns {number|null} cell index (0–8), or null if model not in cache
 */
export function getLocalMove(modelId, board) {
  const cached = modelCache.get(modelId)
  if (!cached) return null
  return selectMove(cached.qtable, board)
}

/**
 * Returns true if the model is already in the local cache.
 */
export function isModelCached(modelId) {
  return modelCache.has(modelId)
}

/**
 * Evict a model from the cache (call after training completes so the
 * stale Q-table is not used for the next game).
 */
export function evictModel(modelId) {
  modelCache.delete(modelId)
}
