/**
 * Rule Extraction Service
 *
 * Analyses a trained ML model (any algorithm) and produces a priority-ordered
 * set of IF-THEN rules that describe its learned strategy.
 *
 * Tabular models (Q-Learning, SARSA, Monte Carlo, Policy Gradient):
 *   Iterate every entry in the Q-table, classify the best move for each state.
 *
 * Neural-net models (DQN, AlphaZero):
 *   Enumerate all ~5,478 legal board positions via DFS, run inference on each.
 *
 * For each rule, we measure:
 *   - coverage:   number of states where the rule is the highest-priority applicable rule
 *   - confidence: fraction of those states where the model actually chose that rule's move
 *
 * Ensemble extraction merges results from multiple models using weighted
 * average confidence scores.
 */

import db from '../lib/db.js'
import {
  QLearningEngine,
  SarsaEngine,
  MonteCarloEngine,
  PolicyGradientEngine,
  DQNEngine,
  AlphaZeroEngine,
  getWinner, isBoardFull, getEmptyCells,
  RULE_IDS, RULE_META, applyRule,
} from '@xo-arena/ai'

// ─── Engine helpers ───────────────────────────────────────────────────────────

function buildEngine(model) {
  const alg = (model.algorithm || 'Q_LEARNING').toUpperCase()
  let engine
  if      (alg === 'SARSA')           engine = new SarsaEngine(model.config)
  else if (alg === 'MONTE_CARLO')     engine = new MonteCarloEngine(model.config)
  else if (alg === 'POLICY_GRADIENT') engine = new PolicyGradientEngine(model.config)
  else if (alg === 'DQN')             engine = new DQNEngine(model.config)
  else if (alg === 'ALPHA_ZERO')      engine = new AlphaZeroEngine(model.config)
  else                                engine = new QLearningEngine(model.config)
  engine.loadQTable(model.qtable)
  return engine
}

const NEURAL_NET_ALGS = new Set(['DQN', 'ALPHA_ZERO'])

/** Determine whose turn it is from a board state. */
function getTurn(board) {
  const xCount = board.filter(c => c === 'X').length
  const oCount = board.filter(c => c === 'O').length
  return xCount === oCount ? 'X' : 'O'
}

function isTerminal(board) {
  return getWinner(board) !== null || isBoardFull(board)
}

// ─── State enumeration (for neural nets) ─────────────────────────────────────

let _cachedLegalStates = null

function enumerateLegalStates() {
  if (_cachedLegalStates) return _cachedLegalStates
  const seen = new Set()
  const states = []

  function dfs(board) {
    const key = board.map(c => c ?? '.').join('')
    if (seen.has(key)) return
    seen.add(key)
    if (isTerminal(board)) return
    states.push([...board])
    const turn = getTurn(board)
    for (let i = 0; i < 9; i++) {
      if (board[i] === null) {
        const next = [...board]; next[i] = turn
        dfs(next)
      }
    }
  }

  dfs(Array(9).fill(null))
  _cachedLegalStates = states
  return states
}

// ─── Move-pair extraction ─────────────────────────────────────────────────────

/** Tabular models: read best moves directly from Q-table keys. */
function movePairsFromQTable(qtable) {
  const pairs = []
  for (const [key, qvals] of Object.entries(qtable)) {
    if (!Array.isArray(qvals)) continue
    const board = key.split('').map(c => c === '.' ? null : c)
    if (isTerminal(board)) continue
    const empty = getEmptyCells(board)
    if (empty.length === 0) continue
    const bestMove = empty.reduce((b, i) => qvals[i] > qvals[b] ? i : b, empty[0])
    pairs.push({ board, move: bestMove, mark: getTurn(board) })
  }
  return pairs
}

/** Neural-net models: run inference over all enumerated states. */
function movePairsFromNeuralNet(engine) {
  const states = enumerateLegalStates()
  const pairs = []
  for (const board of states) {
    const mark = getTurn(board)
    try {
      const move = engine.chooseAction(board, mark, false)
      if (move != null && move >= 0 && move <= 8) {
        pairs.push({ board, move, mark })
      }
    } catch { /* skip on inference error */ }
  }
  return pairs
}

// ─── Rule statistics ──────────────────────────────────────────────────────────

/**
 * For each move pair, find which rule is the highest-priority applicable rule,
 * then check whether the model's move matches it.
 *
 * Returns: { ruleId → { applicable, followed } }
 */
function computeRuleStats(movePairs) {
  const stats = Object.fromEntries(RULE_IDS.map(id => [id, { applicable: 0, followed: 0 }]))

  for (const { board, move, mark } of movePairs) {
    for (const ruleId of RULE_IDS) {
      const ruleMove = applyRule(board, mark, ruleId)
      if (ruleMove !== null) {
        stats[ruleId].applicable++
        if (ruleMove === move) {
          stats[ruleId].followed++
          break // only credit the highest-priority applicable rule
        }
        break // rule applied but model ignored it; don't credit lower rules
      }
    }
  }

  return stats
}

/**
 * Build the final rule entry array from raw stats.
 * win and block always stay at priorities 1 and 2.
 * The remaining rules are sorted by confidence (descending).
 */
function buildRuleEntries(stats) {
  const entries = RULE_IDS.map((id, idx) => {
    const s = stats[id]
    const confidence = s.applicable > 0 ? s.followed / s.applicable : 0
    return {
      id,
      label: RULE_META[id].label,
      desc:  RULE_META[id].desc,
      priority: idx + 1,
      confidence: parseFloat(confidence.toFixed(3)),
      coverage: s.applicable,
      enabled: true,
    }
  })

  const mandatory = entries.slice(0, 2) // win, block
  const flexible  = entries.slice(2).sort((a, b) => b.confidence - a.confidence)
  return [...mandatory, ...flexible].map((r, i) => ({ ...r, priority: i + 1 }))
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract rules from a single trained model.
 * Returns { rules: RuleEntry[], movePairsAnalyzed: number }
 */
export async function extractRulesFromModel(modelId) {
  const model = await db.mLModel.findUnique({ where: { id: modelId } })
  if (!model) throw new Error(`Model ${modelId} not found`)

  const alg = (model.algorithm || 'Q_LEARNING').toUpperCase()
  const engine = buildEngine(model)
  const movePairs = NEURAL_NET_ALGS.has(alg)
    ? movePairsFromNeuralNet(engine)
    : movePairsFromQTable(model.qtable)

  const stats = computeRuleStats(movePairs)
  const rules = buildRuleEntries(stats)
  return { rules, movePairsAnalyzed: movePairs.length }
}

/**
 * Extract rules from multiple models and merge via weighted average confidence.
 * sourceModels: [{ modelId: string, weight: number }]
 */
export async function extractRulesFromEnsemble(sourceModels) {
  const results = await Promise.all(
    sourceModels.map(({ modelId }) => extractRulesFromModel(modelId))
  )

  const totalWeight = sourceModels.reduce((s, m) => s + (m.weight ?? 1), 0)
  const aggConf  = Object.fromEntries(RULE_IDS.map(id => [id, 0]))
  const aggCov   = Object.fromEntries(RULE_IDS.map(id => [id, 0]))

  for (let i = 0; i < results.length; i++) {
    const w = (sourceModels[i].weight ?? 1) / totalWeight
    for (const rule of results[i].rules) {
      aggConf[rule.id] += rule.confidence * w
      aggCov[rule.id]  += rule.coverage
    }
  }

  const entries = RULE_IDS.map((id, idx) => ({
    id,
    label: RULE_META[id].label,
    desc:  RULE_META[id].desc,
    priority: idx + 1,
    confidence: parseFloat(aggConf[id].toFixed(3)),
    coverage: aggCov[id],
    enabled: true,
  }))

  const mandatory = entries.slice(0, 2)
  const flexible  = entries.slice(2).sort((a, b) => b.confidence - a.confidence)
  return [...mandatory, ...flexible].map((r, i) => ({ ...r, priority: i + 1 }))
}
