// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tests for GET /api/v1/config/sw — Service Worker kill-switch endpoint.
 * See backend/src/routes/swControl.js + doc/Performance_Plan_v2.md §Phase 20.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../services/skillService.js', () => ({
  getSystemConfig: vi.fn((_key, def) => Promise.resolve(def)),
}))

const swControlRouter = (await import('../swControl.js')).default
const { getSystemConfig } = await import('../../services/skillService.js')

const app = express()
app.use('/api/v1/config/sw', swControlRouter)

beforeEach(() => {
  vi.clearAllMocks()
  getSystemConfig.mockImplementation((_key, def) => Promise.resolve(def))
})

describe('GET /api/v1/config/sw', () => {
  it('returns defaults (enabled=true, version=1) when no SystemConfig rows exist', async () => {
    const res = await request(app).get('/api/v1/config/sw')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ enabled: true, version: 1 })
  })

  it('reflects sw.enabled=false override (kill switch on)', async () => {
    getSystemConfig.mockImplementation((key, def) => {
      if (key === 'sw.enabled') return Promise.resolve(false)
      return Promise.resolve(def)
    })
    const res = await request(app).get('/api/v1/config/sw')
    expect(res.body.enabled).toBe(false)
    expect(res.body.version).toBe(1)
  })

  it('reflects sw.version override for cache invalidation', async () => {
    getSystemConfig.mockImplementation((key, def) => {
      if (key === 'sw.version') return Promise.resolve(7)
      return Promise.resolve(def)
    })
    const res = await request(app).get('/api/v1/config/sw')
    expect(res.body.enabled).toBe(true)
    expect(res.body.version).toBe(7)
  })

  it('ignores non-boolean enabled values (defensive)', async () => {
    getSystemConfig.mockImplementation((key, def) => {
      if (key === 'sw.enabled') return Promise.resolve('yes')   // bad type
      return Promise.resolve(def)
    })
    const res = await request(app).get('/api/v1/config/sw')
    expect(res.body.enabled).toBe(true)   // fell through to default
  })

  it('ignores non-integer version values (defensive)', async () => {
    getSystemConfig.mockImplementation((key, def) => {
      if (key === 'sw.version') return Promise.resolve(3.14)   // float, not int
      return Promise.resolve(def)
    })
    const res = await request(app).get('/api/v1/config/sw')
    expect(res.body.version).toBe(1)   // fell through to default
  })

  it('fails open when SystemConfig throws', async () => {
    getSystemConfig.mockRejectedValue(new Error('db down'))
    const res = await request(app).get('/api/v1/config/sw')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ enabled: true, version: 1 })
  })

  it('sets a short Cache-Control so kill-switch flips propagate within 30s', async () => {
    const res = await request(app).get('/api/v1/config/sw')
    expect(res.headers['cache-control']).toBe('public, max-age=30')
  })
})
