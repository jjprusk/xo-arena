import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import aiRouter from '../ai.js'

const app = express()
app.use(express.json())
app.use('/api/v1/ai', aiRouter)

describe('GET /api/v1/ai/implementations', () => {
  it('returns implementations array', async () => {
    const res = await request(app).get('/api/v1/ai/implementations')
    expect(res.status).toBe(200)
    expect(res.body.implementations).toBeInstanceOf(Array)
    expect(res.body.implementations.length).toBeGreaterThan(0)
    expect(res.body.implementations[0]).toMatchObject({
      id: 'minimax',
      name: expect.any(String),
      supportedDifficulties: ['novice', 'intermediate', 'advanced', 'master'],
    })
  })
})

describe('POST /api/v1/ai/move', () => {
  const validBody = {
    board: Array(9).fill(null),
    difficulty: 'novice',
    player: 'X',
    implementation: 'minimax',
  }

  it('returns a valid move on empty board', async () => {
    const res = await request(app).post('/api/v1/ai/move').send(validBody)
    expect(res.status).toBe(200)
    expect(res.body.move).toBeGreaterThanOrEqual(0)
    expect(res.body.move).toBeLessThanOrEqual(8)
    expect(res.body.implementation).toBe('minimax')
    expect(typeof res.body.durationMs).toBe('number')
  })

  it('returns 400 for invalid board', async () => {
    const res = await request(app)
      .post('/api/v1/ai/move')
      .send({ ...validBody, board: [1, 2, 3] })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid difficulty', async () => {
    const res = await request(app)
      .post('/api/v1/ai/move')
      .send({ ...validBody, difficulty: 'extreme' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid player', async () => {
    const res = await request(app)
      .post('/api/v1/ai/move')
      .send({ ...validBody, player: 'Z' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for unknown implementation', async () => {
    const res = await request(app)
      .post('/api/v1/ai/move')
      .send({ ...validBody, implementation: 'unknown-ai' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when board has no empty cells', async () => {
    const fullBoard = ['X', 'O', 'X', 'O', 'X', 'O', 'O', 'X', 'O']
    const res = await request(app)
      .post('/api/v1/ai/move')
      .send({ ...validBody, board: fullBoard })
    expect(res.status).toBe(400)
  })
})
