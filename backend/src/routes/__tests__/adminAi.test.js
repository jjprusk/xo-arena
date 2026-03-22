import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth:  (_req, _res, next) => next(),
  requireAdmin: (_req, _res, next) => next(),
}))

import adminAiRouter from '../adminAi.js'
import { _reset, recordMove } from '../../services/aiMetrics.js'

const app = express()
app.use(express.json())
app.use('/api/v1/admin/ai', adminAiRouter)

beforeEach(() => _reset())

describe('GET /api/v1/admin/ai/summary', () => {
  it('returns empty when no data', async () => {
    const res = await request(app).get('/api/v1/admin/ai/summary')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(0)
    expect(res.body.rows).toEqual([])
  })

  it('returns aggregated rows after recording moves', async () => {
    recordMove({ implementation: 'minimax', difficulty: 'master', durationMs: 10, cellIndex: 4 })
    recordMove({ implementation: 'minimax', difficulty: 'master', durationMs: 20, cellIndex: 0 })

    const res = await request(app).get('/api/v1/admin/ai/summary')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.rows).toHaveLength(1)
    expect(res.body.rows[0].avgMs).toBe(15)
  })
})

describe('GET /api/v1/admin/ai/histogram', () => {
  it('returns 6 buckets', async () => {
    const res = await request(app).get('/api/v1/admin/ai/histogram')
    expect(res.status).toBe(200)
    expect(res.body.histogram).toHaveLength(6)
  })

  it('buckets correctly', async () => {
    recordMove({ implementation: 'minimax', difficulty: 'master', durationMs: 5, cellIndex: 0 })
    recordMove({ implementation: 'minimax', difficulty: 'master', durationMs: 600, cellIndex: 0 })

    const res = await request(app).get('/api/v1/admin/ai/histogram')
    const hist = res.body.histogram
    expect(hist.find((b) => b.label === '0–10ms').count).toBe(1)
    expect(hist.find((b) => b.label === '500ms+').count).toBe(1)
  })
})

describe('GET /api/v1/admin/ai/heatmap', () => {
  it('returns 9 cells', async () => {
    const res = await request(app).get('/api/v1/admin/ai/heatmap')
    expect(res.status).toBe(200)
    expect(res.body.heatmap).toHaveLength(9)
  })

  it('counts cell selections', async () => {
    recordMove({ implementation: 'minimax', difficulty: 'master', durationMs: 5, cellIndex: 4 })
    recordMove({ implementation: 'minimax', difficulty: 'master', durationMs: 5, cellIndex: 4 })

    const res = await request(app).get('/api/v1/admin/ai/heatmap')
    expect(res.body.heatmap[4].count).toBe(2)
    expect(res.body.heatmap[0].count).toBe(0)
  })
})
