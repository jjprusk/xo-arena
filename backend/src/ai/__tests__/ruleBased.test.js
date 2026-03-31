import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/db.js', () => ({
  default: {
    ruleSet: {
      findUnique: vi.fn(),
    },
  },
}))

// Use the real @xo-arena/ai — applyRule and getEmptyCells are pure functions
// that need no mocking for these tests.

const db = (await import('../../lib/db.js')).default
const { ruleBasedMove, invalidateRuleSetCache } = await import('../ruleBased.js')

const EMPTY_BOARD = Array(9).fill(null)

// Board where X can win immediately by playing cell 2 (top-right, completes row 0-1-2)
// X: 0,1 | O: 3,4 | empty: 2,5,6,7,8
const WIN_BOARD = ['X', 'X', null, 'O', 'O', null, null, null, null]

beforeEach(() => {
  vi.clearAllMocks()
  // Clear the module-level cache between tests
  invalidateRuleSetCache('rs-1')
  invalidateRuleSetCache('rs-2')
  invalidateRuleSetCache('missing-rs')
})

describe('ruleBasedMove', () => {
  it('returns a valid index into empty cells when no ruleSetId given (null)', async () => {
    const move = await ruleBasedMove(EMPTY_BOARD, 'intermediate', 'X', null)
    expect(typeof move).toBe('number')
    expect(move).toBeGreaterThanOrEqual(0)
    expect(move).toBeLessThanOrEqual(8)
    expect(EMPTY_BOARD[move]).toBeNull()
  })

  it('returns a valid index into empty cells when no ruleSetId given (undefined)', async () => {
    const move = await ruleBasedMove(EMPTY_BOARD, 'intermediate', 'X', undefined)
    expect(typeof move).toBe('number')
    expect(EMPTY_BOARD[move]).toBeNull()
  })

  it('does not call db when no ruleSetId given', async () => {
    await ruleBasedMove(EMPTY_BOARD, 'intermediate', 'X', null)
    expect(db.ruleSet.findUnique).not.toHaveBeenCalled()
  })

  it('calls db.ruleSet.findUnique with the correct ruleSetId', async () => {
    db.ruleSet.findUnique.mockResolvedValue({ id: 'rs-1', rules: [] })
    await ruleBasedMove(EMPTY_BOARD, 'intermediate', 'X', 'rs-1')
    expect(db.ruleSet.findUnique).toHaveBeenCalledWith({ where: { id: 'rs-1' } })
  })

  it('caches rules — db is called only once for repeated calls with the same ruleSetId', async () => {
    db.ruleSet.findUnique.mockResolvedValue({ id: 'rs-1', rules: [] })
    await ruleBasedMove(EMPTY_BOARD, 'intermediate', 'X', 'rs-1')
    await ruleBasedMove(EMPTY_BOARD, 'intermediate', 'X', 'rs-1')
    await ruleBasedMove(EMPTY_BOARD, 'intermediate', 'X', 'rs-1')
    expect(db.ruleSet.findUnique).toHaveBeenCalledOnce()
  })

  it('calls db again after invalidateRuleSetCache clears the cache', async () => {
    db.ruleSet.findUnique.mockResolvedValue({ id: 'rs-1', rules: [] })
    await ruleBasedMove(EMPTY_BOARD, 'intermediate', 'X', 'rs-1')
    expect(db.ruleSet.findUnique).toHaveBeenCalledOnce()

    invalidateRuleSetCache('rs-1')
    await ruleBasedMove(EMPTY_BOARD, 'intermediate', 'X', 'rs-1')
    expect(db.ruleSet.findUnique).toHaveBeenCalledTimes(2)
  })

  it('throws when the ruleSet is not found in the db', async () => {
    db.ruleSet.findUnique.mockResolvedValue(null)
    await expect(
      ruleBasedMove(EMPTY_BOARD, 'intermediate', 'X', 'missing-rs')
    ).rejects.toThrow('RuleSet missing-rs not found')
  })

  it('applies rules in ascending priority order — highest priority (lowest number) wins', async () => {
    // priority 1 = 'win' (cell 2 closes the top row for X on WIN_BOARD)
    // priority 2 = 'side' (would be picked if 'win' were not present)
    db.ruleSet.findUnique.mockResolvedValue({
      id: 'rs-1',
      rules: [
        { id: 'side', priority: 2, enabled: true },
        { id: 'win',  priority: 1, enabled: true },
      ],
    })
    const move = await ruleBasedMove(WIN_BOARD, 'intermediate', 'X', 'rs-1')
    expect(move).toBe(2)
  })

  it('skips disabled rules', async () => {
    // 'win' is disabled; 'side' is active — first available side on WIN_BOARD is 5
    db.ruleSet.findUnique.mockResolvedValue({
      id: 'rs-1',
      rules: [
        { id: 'win',  priority: 1, enabled: false },
        { id: 'side', priority: 2, enabled: true  },
      ],
    })
    // WIN_BOARD sides: 1 (taken by X), 3 (taken by O), 5 (free), 7 (free)
    const move = await ruleBasedMove(WIN_BOARD, 'intermediate', 'X', 'rs-1')
    expect(move).toBe(5)
  })

  it('falls back to a random legal move when no rule matches', async () => {
    db.ruleSet.findUnique.mockResolvedValue({ id: 'rs-1', rules: [] })
    const move = await ruleBasedMove(WIN_BOARD, 'intermediate', 'X', 'rs-1')
    expect(typeof move).toBe('number')
    expect(WIN_BOARD[move]).toBeNull()
  })

  it('returns a valid cell index (0-8, not occupied)', async () => {
    db.ruleSet.findUnique.mockResolvedValue({
      id: 'rs-1',
      rules: [{ id: 'center', priority: 1, enabled: true }],
    })
    const move = await ruleBasedMove(EMPTY_BOARD, 'intermediate', 'X', 'rs-1')
    expect(move).toBeGreaterThanOrEqual(0)
    expect(move).toBeLessThanOrEqual(8)
    expect(EMPTY_BOARD[move]).toBeNull()
    // center rule on empty board should return 4
    expect(move).toBe(4)
  })
})

describe('invalidateRuleSetCache', () => {
  it('is a no-op when the id is not in the cache', () => {
    expect(() => invalidateRuleSetCache('never-cached')).not.toThrow()
  })

  it('allows independent caches per ruleSetId', async () => {
    db.ruleSet.findUnique.mockResolvedValue({ id: 'rs-1', rules: [] })
    await ruleBasedMove(EMPTY_BOARD, 'intermediate', 'X', 'rs-1')
    db.ruleSet.findUnique.mockResolvedValue({ id: 'rs-2', rules: [] })
    await ruleBasedMove(EMPTY_BOARD, 'intermediate', 'X', 'rs-2')
    expect(db.ruleSet.findUnique).toHaveBeenCalledTimes(2)

    // Invalidate only rs-1; rs-2 should still be cached
    invalidateRuleSetCache('rs-1')
    db.ruleSet.findUnique.mockResolvedValue({ id: 'rs-1', rules: [] })
    await ruleBasedMove(EMPTY_BOARD, 'intermediate', 'X', 'rs-1')
    await ruleBasedMove(EMPTY_BOARD, 'intermediate', 'X', 'rs-2')
    // rs-1 reloaded once more; rs-2 still cached
    expect(db.ruleSet.findUnique).toHaveBeenCalledTimes(3)
  })
})
