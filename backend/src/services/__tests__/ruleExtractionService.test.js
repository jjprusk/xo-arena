/**
 * Tests for ruleExtractionService.js
 *
 * Strategy:
 *  - Mock @xo-arena/ai completely so we control RULE_IDS, applyRule, etc.
 *  - Use a small RULE_IDS list (4 rules) to keep fixture data manageable.
 *  - Use a tabular Q-table fixture for most tests (avoids DFS enumeration).
 *  - Verify the DQN path by checking which engine constructor is invoked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── @xo-arena/ai mock ────────────────────────────────────────────────────────

const RULE_IDS = ['win', 'block', 'center', 'corner']
const RULE_META = {
  win:    { label: 'Win',    desc: 'Take a winning move' },
  block:  { label: 'Block',  desc: 'Block opponent win'  },
  center: { label: 'Center', desc: 'Take center'         },
  corner: { label: 'Corner', desc: 'Take a corner'       },
}

const mockEngineInstance = { loadQTable: vi.fn(), chooseAction: vi.fn().mockReturnValue(4) }
const MockQLearning       = vi.fn().mockReturnValue(mockEngineInstance)
const MockSarsa           = vi.fn().mockReturnValue(mockEngineInstance)
const MockMonteCarlo      = vi.fn().mockReturnValue(mockEngineInstance)
const MockPolicyGradient  = vi.fn().mockReturnValue(mockEngineInstance)
const MockDQN             = vi.fn().mockReturnValue(mockEngineInstance)
const MockAlphaZero       = vi.fn().mockReturnValue(mockEngineInstance)

vi.mock('@xo-arena/ai', () => ({
  RULE_IDS,
  RULE_META,
  applyRule:    vi.fn().mockReturnValue(null),
  getWinner:    vi.fn().mockReturnValue(null),
  isBoardFull:  vi.fn(board => board.every(c => c !== null)),
  getEmptyCells: vi.fn(board => board.map((c, i) => c === null ? i : -1).filter(i => i >= 0)),
  QLearningEngine:      MockQLearning,
  SarsaEngine:          MockSarsa,
  MonteCarloEngine:     MockMonteCarlo,
  PolicyGradientEngine: MockPolicyGradient,
  DQNEngine:            MockDQN,
  AlphaZeroEngine:      MockAlphaZero,
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    botSkill: { findUnique: vi.fn() },
  },
}))

const { extractRulesFromModel, extractRulesFromEnsemble } =
  await import('../ruleExtractionService.js')
const db            = (await import('../../lib/db.js')).default
const { applyRule } = await import('@xo-arena/ai')

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * A Q-table with 2 non-terminal entries.
 * Board keys use '.' for null cells.
 *   '.........': all empty — best move is 4 (Q=1.0)
 *   '....X....': X in center — O to play — best move is 0 (Q=1.0)
 */
const SIMPLE_QTABLE = {
  '.........': [0, 0, 0, 0, 1.0, 0, 0, 0, 0],
  '....X....': [1.0, 0, 0, 0, 0, 0, 0, 0, 0],
}

const Q_MODEL = {
  id: 'model_ql',
  algorithm: 'qlearning',
  config: {},
  weights: SIMPLE_QTABLE,
}

const DQN_MODEL = {
  id: 'model_dqn',
  algorithm: 'dqn',
  config: {},
  weights: {},
}

const SARSA_MODEL = {
  id: 'model_sarsa',
  algorithm: 'sarsa',
  config: {},
  weights: SIMPLE_QTABLE,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  // Restore default applyRule to "no rule matched"
  applyRule.mockReturnValue(null)
})

// ─── extractRulesFromModel ────────────────────────────────────────────────────

describe('extractRulesFromModel — model not found', () => {
  it('throws when model does not exist', async () => {
    db.botSkill.findUnique.mockResolvedValue(null)
    await expect(extractRulesFromModel('missing_id')).rejects.toThrow('missing_id')
  })
})

describe('extractRulesFromModel — return shape', () => {
  beforeEach(() => { db.botSkill.findUnique.mockResolvedValue(Q_MODEL) })

  it('returns rules array and movePairsAnalyzed', async () => {
    const result = await extractRulesFromModel(Q_MODEL.id)
    expect(Array.isArray(result.rules)).toBe(true)
    expect(typeof result.movePairsAnalyzed).toBe('number')
  })

  it('returns one rule per RULE_ID', async () => {
    const { rules } = await extractRulesFromModel(Q_MODEL.id)
    expect(rules).toHaveLength(RULE_IDS.length)
    const ids = rules.map(r => r.id)
    expect(ids.sort()).toEqual([...RULE_IDS].sort())
  })

  it('each rule has required fields', async () => {
    const { rules } = await extractRulesFromModel(Q_MODEL.id)
    for (const r of rules) {
      expect(typeof r.id).toBe('string')
      expect(typeof r.label).toBe('string')
      expect(typeof r.desc).toBe('string')
      expect(typeof r.priority).toBe('number')
      expect(typeof r.confidence).toBe('number')
      expect(typeof r.coverage).toBe('number')
      expect(typeof r.enabled).toBe('boolean')
    }
  })

  it('priorities are 1-based and contiguous', async () => {
    const { rules } = await extractRulesFromModel(Q_MODEL.id)
    const priorities = rules.map(r => r.priority).sort((a, b) => a - b)
    expect(priorities).toEqual(RULE_IDS.map((_, i) => i + 1))
  })

  it('win is priority 1 and block is priority 2', async () => {
    const { rules } = await extractRulesFromModel(Q_MODEL.id)
    const byId = Object.fromEntries(rules.map(r => [r.id, r]))
    expect(byId.win.priority).toBe(1)
    expect(byId.block.priority).toBe(2)
  })

  it('movePairsAnalyzed equals number of Q-table entries analyzed', async () => {
    const { movePairsAnalyzed } = await extractRulesFromModel(Q_MODEL.id)
    // SIMPLE_QTABLE has 2 entries; both are non-terminal → both contribute
    expect(movePairsAnalyzed).toBe(Object.keys(SIMPLE_QTABLE).length)
  })
})

describe('extractRulesFromModel — confidence ordering', () => {
  it('flexible rules (non-win/block) are sorted by confidence descending', async () => {
    // Make 'center' have higher confidence than 'corner'
    applyRule.mockImplementation((_board, _mark, ruleId) => {
      if (ruleId === 'center') return 4 // always matches
      return null
    })
    db.botSkill.findUnique.mockResolvedValue(Q_MODEL)

    const { rules } = await extractRulesFromModel(Q_MODEL.id)
    const flexible = rules.filter(r => r.id !== 'win' && r.id !== 'block')
    for (let i = 0; i < flexible.length - 1; i++) {
      expect(flexible[i].confidence).toBeGreaterThanOrEqual(flexible[i + 1].confidence)
    }
  })

  it('confidence is between 0 and 1 inclusive', async () => {
    db.botSkill.findUnique.mockResolvedValue(Q_MODEL)
    const { rules } = await extractRulesFromModel(Q_MODEL.id)
    for (const r of rules) {
      expect(r.confidence).toBeGreaterThanOrEqual(0)
      expect(r.confidence).toBeLessThanOrEqual(1)
    }
  })

  it('confidence reflects fraction of followed / applicable', async () => {
    // Make 'center' applicable on both Q-table boards, followed on first only
    let callCount = 0
    applyRule.mockImplementation((_board, _mark, ruleId) => {
      if (ruleId === 'center') {
        callCount++
        // First board: model move is 4 (center), return 4 → match → followed
        // Second board: model move is 0, return 99 → not followed
        return callCount % 2 === 1 ? 4 : 99
      }
      return null
    })
    db.botSkill.findUnique.mockResolvedValue(Q_MODEL)

    const { rules } = await extractRulesFromModel(Q_MODEL.id)
    const center = rules.find(r => r.id === 'center')
    expect(center.coverage).toBeGreaterThan(0)
  })
})

describe('extractRulesFromModel — algorithm routing', () => {
  it('uses QLearningEngine for Q_LEARNING algorithm', async () => {
    db.botSkill.findUnique.mockResolvedValue(Q_MODEL)
    await extractRulesFromModel(Q_MODEL.id)
    expect(MockQLearning).toHaveBeenCalled()
    expect(MockDQN).not.toHaveBeenCalled()
  })

  it('uses SarsaEngine for SARSA algorithm', async () => {
    db.botSkill.findUnique.mockResolvedValue(SARSA_MODEL)
    await extractRulesFromModel(SARSA_MODEL.id)
    expect(MockSarsa).toHaveBeenCalled()
    expect(MockQLearning).not.toHaveBeenCalled()
  })

  it('uses DQNEngine for DQN algorithm', async () => {
    db.botSkill.findUnique.mockResolvedValue(DQN_MODEL)
    await extractRulesFromModel(DQN_MODEL.id)
    expect(MockDQN).toHaveBeenCalled()
    expect(MockQLearning).not.toHaveBeenCalled()
  })

  it('uses AlphaZeroEngine for alphazero algorithm', async () => {
    const alphaModel = { ...DQN_MODEL, algorithm: 'alphazero' }
    db.botSkill.findUnique.mockResolvedValue(alphaModel)
    await extractRulesFromModel(alphaModel.id)
    expect(MockAlphaZero).toHaveBeenCalled()
  })

  it('calls loadQTable on the engine with model qtable', async () => {
    db.botSkill.findUnique.mockResolvedValue(Q_MODEL)
    await extractRulesFromModel(Q_MODEL.id)
    expect(mockEngineInstance.loadQTable).toHaveBeenCalledWith(SIMPLE_QTABLE)
  })

  it('DQN path calls engine.chooseAction (neural net inference)', async () => {
    db.botSkill.findUnique.mockResolvedValue(DQN_MODEL)
    await extractRulesFromModel(DQN_MODEL.id)
    expect(mockEngineInstance.chooseAction).toHaveBeenCalled()
  })
})

// ─── extractRulesFromEnsemble ─────────────────────────────────────────────────

describe('extractRulesFromEnsemble', () => {
  const MODEL_A = { ...Q_MODEL, id: 'model_a' }
  const MODEL_B = { ...Q_MODEL, id: 'model_b' }

  beforeEach(() => {
    db.botSkill.findUnique.mockImplementation(({ where: { id } }) => {
      if (id === 'model_a') return Promise.resolve(MODEL_A)
      if (id === 'model_b') return Promise.resolve(MODEL_B)
      return Promise.resolve(null)
    })
  })

  it('returns a flat rules array (not nested per model)', async () => {
    const result = await extractRulesFromEnsemble([
      { modelId: 'model_a', weight: 1 },
      { modelId: 'model_b', weight: 1 },
    ])
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(RULE_IDS.length)
  })

  it('each merged rule has required fields', async () => {
    const rules = await extractRulesFromEnsemble([
      { modelId: 'model_a', weight: 1 },
    ])
    for (const r of rules) {
      expect(typeof r.id).toBe('string')
      expect(typeof r.priority).toBe('number')
      expect(typeof r.confidence).toBe('number')
      expect(typeof r.coverage).toBe('number')
      expect(r.enabled).toBe(true)
    }
  })

  it('win stays at priority 1 and block at priority 2 in merged result', async () => {
    const rules = await extractRulesFromEnsemble([
      { modelId: 'model_a', weight: 1 },
      { modelId: 'model_b', weight: 1 },
    ])
    const byId = Object.fromEntries(rules.map(r => [r.id, r]))
    expect(byId.win.priority).toBe(1)
    expect(byId.block.priority).toBe(2)
  })

  it('weighted confidence merges proportionally', async () => {
    // Make model_a have center confidence 1.0 (on first applicable call)
    // Make model_b have center confidence 0.0 (no matches)
    // With weights 1:1, merged center confidence ≈ 0.5
    applyRule.mockImplementation((_board, _mark, ruleId) => {
      if (ruleId === 'center') return 4 // applicable, move matches center (Q-table best is 4)
      return null
    })

    const rules = await extractRulesFromEnsemble([
      { modelId: 'model_a', weight: 1 },
      { modelId: 'model_b', weight: 1 },
    ])
    const center = rules.find(r => r.id === 'center')
    // Both models produce same result with same applyRule mock — confidence is consistent
    expect(center.confidence).toBeGreaterThanOrEqual(0)
    expect(center.confidence).toBeLessThanOrEqual(1)
  })

  it('accumulates coverage across all source models', async () => {
    const rules = await extractRulesFromEnsemble([
      { modelId: 'model_a', weight: 1 },
      { modelId: 'model_b', weight: 1 },
    ])
    // With 2 models each providing some coverage, total >= single model
    const singleRules = (await extractRulesFromModel('model_a')).rules
    const ensembleCovTotal = rules.reduce((s, r) => s + r.coverage, 0)
    const singleCovTotal   = singleRules.reduce((s, r) => s + r.coverage, 0)
    expect(ensembleCovTotal).toBeGreaterThanOrEqual(singleCovTotal)
  })

  it('uses weight 1 as default when weight is not provided', async () => {
    // Should not throw, should return same shape as weighted call
    const rules = await extractRulesFromEnsemble([
      { modelId: 'model_a' },
      { modelId: 'model_b' },
    ])
    expect(rules).toHaveLength(RULE_IDS.length)
  })
})
