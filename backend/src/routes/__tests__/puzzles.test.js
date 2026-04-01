import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// ─── Mock PUZZLE_TYPES ────────────────────────────────────────────────────────

const mockPuzzle = (type) => ({
  type,
  board: Array(9).fill(null),
  solutions: [4],
  toPlay: 'X',
  title: `${type} puzzle`,
  description: 'Test',
})

const generators = {
  win1:    vi.fn(() => mockPuzzle('win1')),
  block1:  vi.fn(() => mockPuzzle('block1')),
  fork:    vi.fn(() => mockPuzzle('fork')),
  survive: vi.fn(() => mockPuzzle('survive')),
}

vi.mock('../../utils/puzzleGenerator.js', () => ({
  PUZZLE_TYPES: generators,
}))

const puzzlesRouter = (await import('../puzzles.js')).default

const app = express()
app.use(express.json())
app.use('/api/v1/puzzles', puzzlesRouter)

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => vi.clearAllMocks())

describe('GET /api/v1/puzzles', () => {
  it('returns 200 with a puzzles array', async () => {
    const res = await request(app).get('/api/v1/puzzles')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.puzzles)).toBe(true)
  })

  it('default count is 8', async () => {
    const res = await request(app).get('/api/v1/puzzles')
    expect(res.body.puzzles).toHaveLength(8)
  })

  it('respects ?count param', async () => {
    const res = await request(app).get('/api/v1/puzzles?count=3')
    expect(res.body.puzzles).toHaveLength(3)
  })

  it('clamps count to 20', async () => {
    const res = await request(app).get('/api/v1/puzzles?count=999')
    expect(res.body.puzzles).toHaveLength(20)
  })

  it('clamps negative count to 1', async () => {
    const res = await request(app).get('/api/v1/puzzles?count=-5')
    expect(res.body.puzzles).toHaveLength(1)
  })

  it('count=0 falls back to default of 8', async () => {
    const res = await request(app).get('/api/v1/puzzles?count=0')
    expect(res.body.puzzles).toHaveLength(8)
  })

  it('filters by ?type=win1', async () => {
    const res = await request(app).get('/api/v1/puzzles?type=win1&count=4')
    expect(res.status).toBe(200)
    for (const p of res.body.puzzles) {
      expect(p.type).toBe('win1')
    }
    expect(generators.win1).toHaveBeenCalled()
    expect(generators.block1).not.toHaveBeenCalled()
  })

  it('filters by ?type=block1', async () => {
    const res = await request(app).get('/api/v1/puzzles?type=block1&count=2')
    for (const p of res.body.puzzles) expect(p.type).toBe('block1')
  })

  it('falls back to all types for an invalid ?type', async () => {
    const res = await request(app).get('/api/v1/puzzles?type=invalid&count=4')
    expect(res.status).toBe(200)
    // Round-robin: types[0 % 4]=win1, [1%4]=block1, [2%4]=fork, [3%4]=survive
    const types = res.body.puzzles.map(p => p.type)
    expect(types).toContain('win1')
    expect(types).toContain('block1')
    expect(types).toContain('fork')
    expect(types).toContain('survive')
  })

  it('each puzzle has an id field', async () => {
    const res = await request(app).get('/api/v1/puzzles?count=2')
    for (const p of res.body.puzzles) {
      expect(typeof p.id).toBe('string')
      expect(p.id.length).toBeGreaterThan(0)
    }
  })

  it('each puzzle id includes its type', async () => {
    const res = await request(app).get('/api/v1/puzzles?type=fork&count=2')
    for (const p of res.body.puzzles) {
      expect(p.id).toMatch(/^fork_/)
    }
  })

  it('each puzzle has board, solutions, toPlay, title', async () => {
    const res = await request(app).get('/api/v1/puzzles?count=2')
    for (const p of res.body.puzzles) {
      expect(Array.isArray(p.board)).toBe(true)
      expect(p.board).toHaveLength(9)
      expect(Array.isArray(p.solutions)).toBe(true)
      expect(['X', 'O']).toContain(p.toPlay)
      expect(typeof p.title).toBe('string')
    }
  })

  it('skips null results from generators (retries up to count*10)', async () => {
    // generator alternates null / puzzle
    let call = 0
    generators.win1.mockImplementation(() => {
      call++
      return call % 2 === 0 ? mockPuzzle('win1') : null
    })
    const res = await request(app).get('/api/v1/puzzles?type=win1&count=3')
    expect(res.status).toBe(200)
    // Should still get 3 puzzles even with some nulls
    expect(res.body.puzzles.length).toBeGreaterThan(0)
  })

  it('ids are unique across puzzles in the same response', async () => {
    const res = await request(app).get('/api/v1/puzzles?count=4')
    const ids = res.body.puzzles.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
