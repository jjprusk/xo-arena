/**
 * Unit tests for mlService CRUD and config functions.
 * Training/inference/socket paths are excluded — they require real engines.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../lib/db.js', () => ({
  default: {
    systemConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    botSkill: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../services/userService.js', () => ({
  resetBotElo: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/eventStream.js', () => ({
  appendToStream: vi.fn().mockResolvedValue('1-0'),
}))

vi.mock('@xo-arena/ai', () => ({
  DEFAULT_CONFIG: {
    learningRate: 0.1,
    discountFactor: 0.9,
    epsilonStart: 1.0,
    epsilonEnd: 0.01,
    epsilonDecay: 0.995,
    hiddenSize: 64,
  },
  QLearningEngine: vi.fn(),
  SarsaEngine: vi.fn(),
  MonteCarloEngine: vi.fn(),
  PolicyGradientEngine: vi.fn(),
  DQNEngine: vi.fn(),
  AlphaZeroEngine: vi.fn(),
  runEpisode: vi.fn(),
  minimaxMove: vi.fn(),
  getWinner: vi.fn(),
  isBoardFull: vi.fn(),
  getEmptyCells: vi.fn(),
  opponent: vi.fn(),
  proportionPValue: vi.fn(),
  twoProportionPValue: vi.fn(),
}))

const {
  getSystemConfig,
  setSystemConfig,
  createModel,
  getModel,
  updateModel,
  deleteModel,
  resetModel,
  cloneModel,
  listModels,
} = await import('../mlService.js')

const db = (await import('../../lib/db.js')).default
const { resetBotElo } = await import('../../services/userService.js')

// ─── Helpers ─────────────────────────────────────────────────────────────────

function flushAsync() {
  return new Promise(resolve => setImmediate(resolve))
}

function makeModel(overrides = {}) {
  return {
    id: 'model_1',
    name: 'Test Model',
    description: null,
    algorithm: 'qlearning',
    weights: {},
    config: { learningRate: 0.1, epsilonStart: 1.0 },
    totalEpisodes: 0,
    maxEpisodes: 100_000,
    featured: false,
    createdBy: null,
    status: 'IDLE',
    createdAt: new Date(),
    _count: { sessions: 0, checkpoints: 0, benchmarks: 0 },
    ...overrides,
  }
}

// ─── getSystemConfig ──────────────────────────────────────────────────────────

describe('getSystemConfig', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the stored value when row exists', async () => {
    db.systemConfig.findUnique.mockResolvedValue({ key: 'ml.maxEpisodesPerModel', value: 50_000 })
    const result = await getSystemConfig('ml.maxEpisodesPerModel', 100_000)
    expect(result).toBe(50_000)
  })

  it('returns defaultValue when row does not exist', async () => {
    db.systemConfig.findUnique.mockResolvedValue(null)
    const result = await getSystemConfig('ml.missing.key', 42)
    expect(result).toBe(42)
  })

  it('returns null default when no defaultValue provided and row missing', async () => {
    db.systemConfig.findUnique.mockResolvedValue(null)
    const result = await getSystemConfig('nope')
    expect(result).toBeNull()
  })
})

// ─── setSystemConfig ──────────────────────────────────────────────────────────

describe('setSystemConfig', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls upsert with correct args', async () => {
    db.systemConfig.upsert.mockResolvedValue({ key: 'k', value: 'v' })
    await setSystemConfig('k', 'v')
    expect(db.systemConfig.upsert).toHaveBeenCalledWith({
      where: { key: 'k' },
      update: { value: 'v' },
      create: { key: 'k', value: 'v' },
    })
  })
})

// ─── createModel ─────────────────────────────────────────────────────────────

describe('createModel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a Q_LEARNING model with defaults', async () => {
    db.systemConfig.findUnique.mockResolvedValue(null) // maxEpisodes → default 100_000
    const created = makeModel({ id: 'new_1', name: 'QL Model', algorithm: 'Q_LEARNING' })
    db.botSkill.create.mockResolvedValue(created)

    const result = await createModel({ name: 'QL Model', algorithm: 'Q_LEARNING' })
    expect(result.id).toBe('new_1')
    expect(db.botSkill.create).toHaveBeenCalledOnce()
    const { data } = db.botSkill.create.mock.calls[0][0]
    expect(data.algorithm).toBe('Q_LEARNING')
    expect(data.maxEpisodes).toBe(100_000)
    expect(data.weights).toEqual({})
    expect(data.createdBy).toBeNull()
  })

  it('stores null description when description is empty string', async () => {
    db.systemConfig.findUnique.mockResolvedValue(null)
    db.botSkill.create.mockResolvedValue(makeModel())
    await createModel({ name: 'M', description: '', algorithm: 'Q_LEARNING' })
    const { data } = db.botSkill.create.mock.calls[0][0]
    expect(data.description).toBeNull()
  })

  it('uses custom maxEpisodes from system config', async () => {
    db.systemConfig.findUnique.mockResolvedValue({ key: 'ml.maxEpisodesPerModel', value: 50_000 })
    db.botSkill.create.mockResolvedValue(makeModel())
    await createModel({ name: 'M', algorithm: 'SARSA' })
    const { data } = db.botSkill.create.mock.calls[0][0]
    expect(data.maxEpisodes).toBe(50_000)
  })

  describe('DQN validation', () => {
    function setupDqnConfig({ maxLayers = 3, maxUnits = 256 } = {}) {
      db.systemConfig.findUnique.mockImplementation(({ where: { key } }) => {
        if (key === 'ml.dqn.defaultHiddenLayers') return { key, value: [32] }
        if (key === 'ml.dqn.maxHiddenLayers')    return { key, value: maxLayers }
        if (key === 'ml.dqn.maxUnitsPerLayer')    return { key, value: maxUnits }
        if (key === 'ml.maxEpisodesPerModel')      return { key, value: 100_000 }
        return null
      })
      db.botSkill.create.mockResolvedValue(makeModel({ algorithm: 'DQN' }))
    }

    it('accepts valid networkShape and bakes layerSizes', async () => {
      setupDqnConfig()
      await createModel({ name: 'DQN', algorithm: 'DQN', config: { networkShape: [64, 32] } })
      const { data } = db.botSkill.create.mock.calls[0][0]
      expect(data.config.layerSizes).toEqual([9, 64, 32, 9])
      expect(data.config.networkShape).toEqual([64, 32])
      expect(data.config.hiddenSize).toBeUndefined()
    })

    it('uses defaultHiddenLayers when no networkShape provided', async () => {
      setupDqnConfig()
      await createModel({ name: 'DQN', algorithm: 'DQN' })
      const { data } = db.botSkill.create.mock.calls[0][0]
      expect(data.config.layerSizes).toEqual([9, 32, 9])
    })

    it('throws 400 when networkShape is empty', async () => {
      setupDqnConfig()
      await expect(
        createModel({ name: 'DQN', algorithm: 'DQN', config: { networkShape: [] } })
      ).rejects.toMatchObject({ status: 400, message: /non-empty array/ })
    })

    it('throws 400 when networkShape exceeds maxLayers', async () => {
      setupDqnConfig({ maxLayers: 2 })
      await expect(
        createModel({ name: 'DQN', algorithm: 'DQN', config: { networkShape: [64, 64, 64] } })
      ).rejects.toMatchObject({ status: 400, message: /maximum of 2 hidden layers/ })
    })

    it('throws 400 when a layer unit count exceeds maxUnits', async () => {
      setupDqnConfig({ maxUnits: 128 })
      await expect(
        createModel({ name: 'DQN', algorithm: 'DQN', config: { networkShape: [256] } })
      ).rejects.toMatchObject({ status: 400, message: /between 1 and 128 units/ })
    })

    it('throws 400 when a layer unit count is zero', async () => {
      setupDqnConfig()
      await expect(
        createModel({ name: 'DQN', algorithm: 'DQN', config: { networkShape: [0] } })
      ).rejects.toMatchObject({ status: 400 })
    })
  })
})

// ─── getModel ────────────────────────────────────────────────────────────────

describe('getModel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when model not found', async () => {
    db.botSkill.findUnique.mockResolvedValue(null)
    const result = await getModel('nope')
    expect(result).toBeNull()
  })

  it('returns model with creatorName when createdBy is set', async () => {
    const model = makeModel({ createdBy: 'ba_user_1' })
    db.botSkill.findUnique.mockResolvedValue(model)
    db.user.findUnique.mockResolvedValue({ displayName: 'Alice', username: 'alice' })

    const result = await getModel('model_1')
    expect(result.creatorName).toBe('Alice')
  })

  it('falls back to username when displayName is null', async () => {
    const model = makeModel({ createdBy: 'ba_user_1' })
    db.botSkill.findUnique.mockResolvedValue(model)
    db.user.findUnique.mockResolvedValue({ displayName: null, username: 'alice' })

    const result = await getModel('model_1')
    expect(result.creatorName).toBe('alice')
  })

  it('returns creatorName null when createdBy is null', async () => {
    const model = makeModel({ createdBy: null })
    db.botSkill.findUnique.mockResolvedValue(model)

    const result = await getModel('model_1')
    expect(result.creatorName).toBeNull()
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })
})

// ─── updateModel ─────────────────────────────────────────────────────────────

describe('updateModel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('only includes defined fields in the update', async () => {
    db.botSkill.update.mockResolvedValue(makeModel({ name: 'New Name' }))
    await updateModel('model_1', { name: 'New Name' })

    const { data } = db.botSkill.update.mock.calls[0][0]
    expect(data).toHaveProperty('name', 'New Name')
    expect(data).not.toHaveProperty('description')
    expect(data).not.toHaveProperty('config')
  })

  it('includes description when explicitly provided', async () => {
    db.botSkill.update.mockResolvedValue(makeModel())
    await updateModel('model_1', { name: 'X', description: 'New desc', config: { lr: 0.05 } })

    const { data } = db.botSkill.update.mock.calls[0][0]
    expect(data.description).toBe('New desc')
    expect(data.config).toEqual({ lr: 0.05 })
  })
})

// ─── deleteModel ─────────────────────────────────────────────────────────────

describe('deleteModel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes the model from the database', async () => {
    db.botSkill.delete.mockResolvedValue({ id: 'model_1' })
    await deleteModel('model_1')
    expect(db.botSkill.delete).toHaveBeenCalledWith({ where: { id: 'model_1' } })
  })
})

// ─── resetModel ──────────────────────────────────────────────────────────────

describe('resetModel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws when model not found', async () => {
    db.botSkill.findUnique.mockResolvedValue(null)
    await expect(resetModel('nope')).rejects.toThrow('Model not found')
  })

  it('resets weights and totalEpisodes, restores initial epsilon', async () => {
    const model = makeModel({ config: { epsilonStart: 0.9, currentEpsilon: 0.1 } })
    db.botSkill.findUnique.mockResolvedValue(model)
    db.botSkill.update.mockResolvedValue({ ...model, weights: {}, totalEpisodes: 0, status: 'IDLE' })
    db.user.findFirst.mockResolvedValue(null) // no bot

    await resetModel('model_1')

    const { data } = db.botSkill.update.mock.calls[0][0]
    expect(data.weights).toEqual({})
    expect(data.totalEpisodes).toBe(0)
    expect(data.status).toBe('IDLE')
    expect(data.config.currentEpsilon).toBe(0.9) // restored from epsilonStart
  })

  it('uses DEFAULT_CONFIG.epsilonStart when epsilonStart missing from config', async () => {
    const model = makeModel({ config: {} })
    db.botSkill.findUnique.mockResolvedValue(model)
    db.botSkill.update.mockResolvedValue(model)
    db.user.findFirst.mockResolvedValue(null)

    await resetModel('model_1')

    const { data } = db.botSkill.update.mock.calls[0][0]
    expect(data.config.currentEpsilon).toBe(1.0) // DEFAULT_CONFIG.epsilonStart
  })

  it('triggers resetBotElo when model is owned by a bot', async () => {
    const model = makeModel()
    db.botSkill.findUnique.mockResolvedValue(model)
    db.botSkill.update.mockResolvedValue(model)
    db.user.findFirst.mockResolvedValue({ id: 'bot_1', isBot: true })

    await resetModel('model_1')
    await flushAsync()

    expect(resetBotElo).toHaveBeenCalledWith('bot_1')
  })

  it('does not call resetBotElo when no bot owns the model', async () => {
    const model = makeModel()
    db.botSkill.findUnique.mockResolvedValue(model)
    db.botSkill.update.mockResolvedValue(model)
    db.user.findFirst.mockResolvedValue(null)

    await resetModel('model_1')
    await flushAsync()

    expect(resetBotElo).not.toHaveBeenCalled()
  })
})

// ─── cloneModel ──────────────────────────────────────────────────────────────

describe('cloneModel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws when source model not found', async () => {
    db.botSkill.findUnique.mockResolvedValue(null)
    await expect(cloneModel('nope', { name: 'Clone' })).rejects.toThrow('Source model not found')
  })

  it('creates a clone with the provided name', async () => {
    const src = makeModel({ name: 'Original', algorithm: 'sarsa' })
    db.botSkill.findUnique.mockResolvedValue(src)
    db.botSkill.create.mockResolvedValue({ ...src, id: 'clone_1', name: 'My Clone' })

    await cloneModel('model_1', { name: 'My Clone', createdBy: 'ba_user_1' })

    const { data } = db.botSkill.create.mock.calls[0][0]
    expect(data.name).toBe('My Clone')
    expect(data.algorithm).toBe('sarsa')
    expect(data.createdBy).toBe('ba_user_1')
  })

  it('defaults name to "<source> (copy)" when no name provided', async () => {
    const src = makeModel({ name: 'Original' })
    db.botSkill.findUnique.mockResolvedValue(src)
    db.botSkill.create.mockResolvedValue({ ...src, id: 'clone_1', name: 'Original (copy)' })

    await cloneModel('model_1', {})

    const { data } = db.botSkill.create.mock.calls[0][0]
    expect(data.name).toBe('Original (copy)')
  })
})

// ─── listModels ───────────────────────────────────────────────────────────────

describe('listModels', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns featured models first', async () => {
    const featured = makeModel({ id: 'm_featured', featured: true, createdBy: null })
    const normal   = makeModel({ id: 'm_normal',   featured: false, createdBy: null })
    db.botSkill.findMany.mockResolvedValue([normal, featured]) // DB order: normal first
    db.user.findMany.mockResolvedValue([])

    const result = await listModels()
    expect(result[0].id).toBe('m_featured')
    expect(result[1].id).toBe('m_normal')
  })

  it('enriches models with creatorName', async () => {
    const model = makeModel({ createdBy: 'ba_1', _count: { sessions: 2 } })
    db.botSkill.findMany.mockResolvedValue([model])
    db.user.findMany.mockResolvedValue([
      { betterAuthId: 'ba_1', displayName: 'Alice', username: 'alice' },
    ])

    const result = await listModels()
    expect(result[0].creatorName).toBe('Alice')
  })

  it('sets creatorName to null for models without creator', async () => {
    const model = makeModel({ createdBy: null })
    db.botSkill.findMany.mockResolvedValue([model])
    db.user.findMany.mockResolvedValue([])

    const result = await listModels()
    expect(result[0].creatorName).toBeNull()
  })
})
