import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma client
vi.mock('../../lib/db.js', () => ({
  default: {
    mLPlayerProfile: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}))

// Mock logger to suppress console noise in tests
vi.mock('../../logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

const {
  recordHumanMove,
  updatePlayerTendencies,
  getPlayerProfiles,
  getPlayerProfile,
  adaptedChooseAction,
} = await import('../mlService.js')

const db = (await import('../../lib/db.js')).default

// ─── Helper to flush microtasks (for fire-and-forget async functions) ─────────

function flushAsync() {
  return new Promise(resolve => setImmediate(resolve))
}

// ─── recordHumanMove tests ────────────────────────────────────────────────────

describe('recordHumanMove', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a profile and increments movePatterns when no profile exists', async () => {
    const board = [null, null, null, null, null, null, null, null, null]
    const cellIndex = 4

    // First call: findUnique returns null (no profile), create returns new profile
    db.mLPlayerProfile.findUnique.mockResolvedValue(null)
    db.mLPlayerProfile.create.mockResolvedValue({
      id: 'prof_1',
      modelId: 'model_1',
      userId: 'user_1',
      gamesRecorded: 0,
      movePatterns: {},
      openingPreferences: {},
      tendencies: {},
    })
    db.mLPlayerProfile.update.mockResolvedValue({})

    recordHumanMove('model_1', 'user_1', board, cellIndex)
    await flushAsync()

    expect(db.mLPlayerProfile.findUnique).toHaveBeenCalledWith({
      where: { modelId_userId: { modelId: 'model_1', userId: 'user_1' } },
    })
    expect(db.mLPlayerProfile.create).toHaveBeenCalledWith({
      data: { modelId: 'model_1', userId: 'user_1' },
    })

    const updateCall = db.mLPlayerProfile.update.mock.calls[0][0]
    const stateKey = board.join(',')
    expect(updateCall.data.movePatterns[stateKey][cellIndex]).toBe(1)
    // Opening preference: 0 occupied cells → counts as opening
    expect(updateCall.data.openingPreferences[cellIndex]).toBe(1)
  })

  it('increments count on a second call for the same state', async () => {
    const board = [null, null, null, null, null, null, null, null, null]
    const cellIndex = 0
    const stateKey = board.join(',')
    const existingPatterns = { [stateKey]: { [cellIndex]: 3 } }

    db.mLPlayerProfile.findUnique.mockResolvedValue({
      id: 'prof_1',
      modelId: 'model_1',
      userId: 'user_1',
      gamesRecorded: 2,
      movePatterns: existingPatterns,
      openingPreferences: { [cellIndex]: 2 },
      tendencies: {},
    })
    db.mLPlayerProfile.update.mockResolvedValue({})

    recordHumanMove('model_1', 'user_1', board, cellIndex)
    await flushAsync()

    const updateCall = db.mLPlayerProfile.update.mock.calls[0][0]
    // Count should be 3+1=4
    expect(updateCall.data.movePatterns[stateKey][cellIndex]).toBe(4)
  })

  it('does not count as opening move when board has 2+ pieces occupied', async () => {
    // Board with 2 pieces already placed — move at index 4
    const board = ['X', 'O', null, null, null, null, null, null, null]
    const cellIndex = 4

    db.mLPlayerProfile.findUnique.mockResolvedValue({
      id: 'prof_1',
      modelId: 'model_1',
      userId: 'user_1',
      gamesRecorded: 1,
      movePatterns: {},
      openingPreferences: {},
      tendencies: {},
    })
    db.mLPlayerProfile.update.mockResolvedValue({})

    recordHumanMove('model_1', 'user_1', board, cellIndex)
    await flushAsync()

    const updateCall = db.mLPlayerProfile.update.mock.calls[0][0]
    // movePatterns should be updated
    const stateKey = board.join(',')
    expect(updateCall.data.movePatterns[stateKey][cellIndex]).toBe(1)
    // openingPreferences should NOT be updated (2 pieces on board)
    expect(updateCall.data.openingPreferences[cellIndex]).toBeUndefined()
  })
})

// ─── getPlayerProfiles tests ──────────────────────────────────────────────────

describe('getPlayerProfiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns all profiles for a model enriched with display names', async () => {
    const mockProfiles = [
      { id: 'p1', userId: 'u1', gamesRecorded: 5, openingPreferences: {}, tendencies: {}, createdAt: new Date() },
      { id: 'p2', userId: 'u2', gamesRecorded: 2, openingPreferences: {}, tendencies: {}, createdAt: new Date() },
    ]
    db.mLPlayerProfile.findMany.mockResolvedValue(mockProfiles)
    db.user.findMany.mockResolvedValue([
      { clerkId: 'u1', displayName: 'Alice', username: 'alice' },
      { clerkId: 'u2', displayName: 'Bob', username: 'bob' },
    ])

    const result = await getPlayerProfiles('model_1')

    expect(db.mLPlayerProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { modelId: 'model_1' } })
    )
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ userId: 'u1', displayName: 'Alice', username: 'alice' })
    expect(result[1]).toMatchObject({ userId: 'u2', displayName: 'Bob', username: 'bob' })
  })

  it('returns empty array when no profiles exist', async () => {
    db.mLPlayerProfile.findMany.mockResolvedValue([])
    const result = await getPlayerProfiles('model_no_profiles')
    expect(result).toEqual([])
  })
})

// ─── getPlayerProfile tests ───────────────────────────────────────────────────

describe('getPlayerProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a single profile for (modelId, userId)', async () => {
    const mockProfile = { id: 'p1', modelId: 'm1', userId: 'u1', gamesRecorded: 3 }
    db.mLPlayerProfile.findUnique.mockResolvedValue(mockProfile)

    const result = await getPlayerProfile('m1', 'u1')
    expect(db.mLPlayerProfile.findUnique).toHaveBeenCalledWith({
      where: { modelId_userId: { modelId: 'm1', userId: 'u1' } },
    })
    expect(result).toEqual(mockProfile)
  })

  it('returns null when profile does not exist', async () => {
    db.mLPlayerProfile.findUnique.mockResolvedValue(null)
    const result = await getPlayerProfile('m1', 'unknown_user')
    expect(result).toBeNull()
  })
})

// ─── adaptedChooseAction tests ────────────────────────────────────────────────

describe('adaptedChooseAction', () => {
  it('biases toward the player preferred move when movePatterns have data', () => {
    // Mock engine with qtable — all Q-values equal (0) so bias determines winner
    const mockEngine = {
      qtable: { '.,.,.,.,.,.,.,.,.' : [0, 0, 0, 0, 0, 0, 0, 0, 0] },
      getQValues: vi.fn().mockReturnValue([0, 0, 0, 0, 0, 0, 0, 0, 0]),
    }

    const board = [null, null, null, null, null, null, null, null, null]
    // Player always plays cell 6 from this state
    const stateKey = board.join(',')
    const profile = {
      movePatterns: {
        [stateKey]: { 6: 10 },   // strongly prefers cell 6
      },
      openingPreferences: {},
      tendencies: {},
    }

    const { getEmptyCells } = vi.hoisted(() => ({
      getEmptyCells: (b) => b.map((v, i) => v === null ? i : -1).filter(i => i >= 0),
    }))

    // The chosen cell should be 6 because it has 100% bias
    const chosen = adaptedChooseAction(mockEngine, board, 'X', profile, 0.5)
    expect(chosen).toBe(6)
  })

  it('falls back to engine.chooseAction for neural engines (no qtable)', () => {
    const mockEngine = {
      // No qtable property — neural engine
      chooseAction: vi.fn().mockReturnValue(3),
    }

    const board = [null, null, null, null, null, null, null, null, null]
    const profile = { movePatterns: {}, openingPreferences: {}, tendencies: {} }

    const chosen = adaptedChooseAction(mockEngine, board, 'X', profile)
    expect(mockEngine.chooseAction).toHaveBeenCalledWith(board, false)
    expect(chosen).toBe(3)
  })

  it('picks the legal cell with the highest adjusted Q-value', () => {
    // Engine prefers cell 4 (Q=0.8), but profile strongly prefers cell 0
    const qvals = [0.1, 0, 0, 0, 0.8, 0, 0, 0, 0.1]
    const mockEngine = {
      qtable: {},
      getQValues: vi.fn().mockReturnValue(qvals),
    }

    const board = [null, null, null, null, null, null, null, null, null]
    const stateKey = board.join(',')
    const profile = {
      movePatterns: {
        [stateKey]: { 0: 100 },  // always plays cell 0
      },
    }

    // With profileWeight=1.0: Q_adj[0] = 0.1 + 1.0*1.0 = 1.1 (beats Q_adj[4]=0.8)
    const chosen = adaptedChooseAction(mockEngine, board, 'X', profile, 1.0)
    expect(chosen).toBe(0)
  })
})
