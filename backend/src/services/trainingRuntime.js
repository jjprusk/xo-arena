// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.10 — per-(game, algorithm) training-runtime resolver.
 *
 * A3b.2b shipped a single global `ml.useWorker` flag — too coarse for
 * Connect 4's mixed workload: TTT Q-learning still wants to run in the
 * browser (5000 episodes / 50 ms each, no server cycles), while C4
 * AlphaZero must run on the worker (heavy MCTS, can't survive tab
 * close). This module replaces the bool with a routing matrix.
 *
 * Matrix shape (SystemConfig `ml.runtimeMatrix`):
 *
 *   {
 *     "<gameId>": {
 *       "<algorithm>": "frontend" | "backend-in-process" | "worker",
 *       "default":     "..."   // game-wide fallback
 *     },
 *     "default": "..."          // global fallback
 *   }
 *
 * Lookup order (first hit wins):
 *   1. matrix[gameId][algorithm]
 *   2. matrix[gameId].default
 *   3. matrix.default
 *   4. legacy ml.useWorker (true → 'worker', false → 'backend-in-process')
 *   5. DEFAULT_MATRIX (hard-coded — TTT lightweights stay frontend, rest worker)
 *
 * Algorithm keys are case-folded to lowercase so callers can pass either
 * `'qlearning'` (UI/DB form) or `'Q_LEARNING'` (legacy enum form) without
 * special-casing the resolver.
 */

const VALID_RUNTIMES = new Set(['frontend', 'backend-in-process', 'worker'])

/**
 * Hard-coded default matrix used when nothing in SystemConfig matches.
 * Lives in code (not config) so a fresh env behaves sanely on day one
 * without an admin having to seed `ml.runtimeMatrix` first.
 *
 * Rationale per algorithm:
 *   - qlearning / sarsa / monte_carlo on TTT: tiny state space, fast in
 *     browser, no point burning worker CPU on them.
 *   - dqn / alphazero anywhere: heavy CPU + GPU; must run server-side
 *     where a tab close can't kill the run.
 *   - any C4 algorithm: defaults to worker — C4 board is 7×6, all
 *     algorithms are non-trivial vs TTT's 3×3.
 */
export const DEFAULT_MATRIX = Object.freeze({
  'tic-tac-toe': {
    qlearning:   'frontend',
    sarsa:       'frontend',
    monte_carlo: 'frontend',
    dqn:         'worker',
    alphazero:   'worker',
    default:     'worker',
  },
  'connect-four': {
    default:     'worker',
  },
  default: 'worker',
})

/**
 * Normalize an algorithm key to the lowercase/underscored form used in
 * the matrix. Accepts: 'qlearning', 'Q_LEARNING', 'QLearning', etc.
 */
function normalizeAlgorithm(algo) {
  if (!algo || typeof algo !== 'string') return ''
  // 'Q_LEARNING' → 'qlearning'; 'monte_carlo' stays; 'AlphaZero' → 'alphazero'.
  // The matrix is hand-edited by admins so we want a single canonical form.
  // Underscores get dropped for the qlearning/sarsa/dqn/alphazero family
  // (because the in-code DB form is unhyphenated), but preserved for the
  // multi-word monte_carlo. This matches mlService.js conventions.
  const lower = algo.toLowerCase()
  if (lower === 'q_learning') return 'qlearning'
  return lower
}

/**
 * Resolve a routing decision. Pure — no I/O outside the injected
 * `getConfig`. Always returns one of the three runtime strings; never
 * throws on missing/garbage config (would block real training over a
 * mis-typed admin edit).
 *
 * @param {string} gameId — e.g. 'tic-tac-toe', 'connect-four'
 * @param {string} algorithm — case-insensitive
 * @param {{ getConfig?: (key:string, fallback?:any) => Promise<any> }} [opts]
 * @returns {Promise<'frontend' | 'backend-in-process' | 'worker'>}
 */
export async function resolveTrainingRuntime(gameId, algorithm, opts = {}) {
  const getConfig = opts.getConfig
  const algo = normalizeAlgorithm(algorithm)

  // Pull matrix + legacy bool in parallel — both are SystemConfig hits.
  const [matrixRaw, useWorker] = await Promise.all([
    getConfig ? getConfig('ml.runtimeMatrix', null).catch(() => null) : Promise.resolve(null),
    getConfig ? getConfig('ml.useWorker',     null).catch(() => null) : Promise.resolve(null),
  ])

  const matrix = (matrixRaw && typeof matrixRaw === 'object' && !Array.isArray(matrixRaw))
    ? matrixRaw
    : null

  // Try matrix lookups in order. Each cell is validated — an admin who
  // typo'd `worker` as `wroker` falls through to the next layer instead
  // of crashing the dispatch.
  const tryCell = (cell) => (VALID_RUNTIMES.has(cell) ? cell : null)

  if (matrix) {
    const gameNode = matrix[gameId] && typeof matrix[gameId] === 'object' ? matrix[gameId] : null
    if (gameNode) {
      const exact = tryCell(gameNode[algo])
      if (exact) return exact
      const gameDefault = tryCell(gameNode.default)
      if (gameDefault) return gameDefault
    }
    const globalDefault = tryCell(matrix.default)
    if (globalDefault) return globalDefault
  }

  // Legacy fallback — keeps existing prod working until an admin seeds
  // the matrix explicitly. `ml.useWorker=true` becomes "worker for
  // everything"; false becomes "in-process for everything".
  if (useWorker === true)  return 'worker'
  if (useWorker === false) return 'backend-in-process'

  // Final fallback: code default. Returns the same shape via the same
  // lookup path, just sourced from DEFAULT_MATRIX instead of SystemConfig.
  const defaultNode = DEFAULT_MATRIX[gameId]
  if (defaultNode) {
    const exact = tryCell(defaultNode[algo])
    if (exact) return exact
    const gameDefault = tryCell(defaultNode.default)
    if (gameDefault) return gameDefault
  }
  return tryCell(DEFAULT_MATRIX.default) ?? 'worker'
}
