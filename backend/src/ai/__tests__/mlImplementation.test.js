import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the entire skillService module so its transitive db/logger deps are never loaded
vi.mock('../../services/skillService.js', () => ({
  getMoveForModel: vi.fn(),
  setIO: vi.fn(),
}))

// Mock @xo-arena/ai only to spy on getEmptyCells — use real implementation via importOriginal
vi.mock('@xo-arena/ai', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual }
})

const { getMoveForModel } = await import('../../services/skillService.js')
const { mlImplementation } = await import('../mlImplementation.js')

const EMPTY_BOARD = Array(9).fill(null)

// Board with X at 0,1,2,3 and O at 4,5 — cells 6,7,8 are empty
const PARTIAL_BOARD = ['X', 'X', 'X', 'X', 'O', 'O', null, null, null]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('mlImplementation.move', () => {
  it('returns a valid empty-cell index when no modelId is given (null)', async () => {
    const move = await mlImplementation.move(EMPTY_BOARD, 'intermediate', 'X', null)
    expect(typeof move).toBe('number')
    expect(move).toBeGreaterThanOrEqual(0)
    expect(move).toBeLessThanOrEqual(8)
    expect(EMPTY_BOARD[move]).toBeNull()
  })

  it('returns a valid empty-cell index when no modelId is given (undefined)', async () => {
    const move = await mlImplementation.move(EMPTY_BOARD, 'intermediate', 'X', undefined)
    expect(typeof move).toBe('number')
    expect(move).toBeGreaterThanOrEqual(0)
    expect(move).toBeLessThanOrEqual(8)
  })

  it('calls getMoveForModel with (modelId, board) when modelId is provided', async () => {
    getMoveForModel.mockResolvedValue(3)
    await mlImplementation.move(EMPTY_BOARD, 'master', 'O', 'model-abc')
    expect(getMoveForModel).toHaveBeenCalledOnce()
    expect(getMoveForModel).toHaveBeenCalledWith('model-abc', EMPTY_BOARD)
  })

  it('returns the value from getMoveForModel when modelId is provided', async () => {
    getMoveForModel.mockResolvedValue(7)
    const move = await mlImplementation.move(EMPTY_BOARD, 'novice', 'X', 'model-xyz')
    expect(move).toBe(7)
  })

  it('does not call getMoveForModel when no modelId is given', async () => {
    await mlImplementation.move(EMPTY_BOARD, 'novice', 'X', null)
    expect(getMoveForModel).not.toHaveBeenCalled()
  })

  it('works on an empty board — all 9 cells are candidates', async () => {
    const seen = new Set()
    // Run enough times to statistically verify all indices are reachable
    for (let i = 0; i < 200; i++) {
      const move = await mlImplementation.move(EMPTY_BOARD, 'novice', 'X', undefined)
      expect(move).toBeGreaterThanOrEqual(0)
      expect(move).toBeLessThanOrEqual(8)
      seen.add(move)
    }
    // All 9 cells should have been returned at some point
    expect(seen.size).toBe(9)
  })

  it('only picks from empty cells on a partially filled board', async () => {
    const emptyCells = [6, 7, 8]
    for (let i = 0; i < 50; i++) {
      const move = await mlImplementation.move(PARTIAL_BOARD, 'novice', 'O', undefined)
      expect(emptyCells).toContain(move)
      expect(PARTIAL_BOARD[move]).toBeNull()
    }
  })
})
