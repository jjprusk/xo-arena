// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 6 — admin guide-config endpoint pair tests.
 *
 * Covers the v1 Guide SystemConfig surface (Sprint6_Kickoff §3.4):
 *   - GET returns all 13 keys with seed defaults when no row exists
 *   - PATCH validates types per spec (boolean / integer / enum / stringArray)
 *   - PATCH rejects unknown + read-only keys (cup.sizeEntrants is v1.1)
 *   - PATCH writes via setSystemConfig and re-returns the updated map
 *   - Validation is all-or-nothing — one bad key blocks the whole batch
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth:  (req, _res, next) => { req.auth = { userId: 'ba_admin_1' }; next() },
  requireAdmin: (_req, _res, next) => next(),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    user:               { count: vi.fn(), findFirst: vi.fn() },
    systemConfig:       { findUnique: vi.fn(), upsert: vi.fn() },
    tournamentAutoDrop: { count: vi.fn(), findMany: vi.fn() },
  },
}))

vi.mock('../../services/skillService.js', () => ({
  deleteModel:     vi.fn(),
  getSystemConfig: vi.fn((_key, def) => Promise.resolve(def)),
  setSystemConfig: vi.fn(),
}))

vi.mock('../../services/metricsSnapshotService.js', () => ({
  runMetricsSnapshot: vi.fn(),
}))

vi.mock('../../services/tableGcService.js', () => ({
  sweep: vi.fn(),
}))

const adminRouter = (await import('../admin.js')).default
const { getSystemConfig, setSystemConfig } = await import('../../services/skillService.js')

const app = express()
app.use(express.json())
app.use('/api/v1/admin', adminRouter)

const ALL_KEYS = [
  'guide.v1.enabled',
  'guide.rewards.hookComplete',
  'guide.rewards.curriculumComplete',
  'guide.rewards.discovery.firstSpecializeAction',
  'guide.rewards.discovery.firstRealTournamentWin',
  'guide.rewards.discovery.firstNonDefaultAlgorithm',
  'guide.rewards.discovery.firstTemplateClone',
  'guide.quickBot.defaultTier',
  'guide.quickBot.firstTrainingTier',
  'guide.cup.sizeEntrants',
  'guide.cup.retentionDays',
  'guide.demo.ttlMinutes',
  'metrics.internalEmailDomains',
]

beforeEach(() => {
  vi.clearAllMocks()
  // Default mock — every getSystemConfig call returns the supplied default.
  getSystemConfig.mockImplementation((_key, def) => Promise.resolve(def))
})

describe('GET /api/v1/admin/guide-config', () => {
  it('returns all 13 v1 keys', async () => {
    const res = await request(app).get('/api/v1/admin/guide-config')
    expect(res.status).toBe(200)
    expect(Object.keys(res.body.config).sort()).toEqual([...ALL_KEYS].sort())
  })

  it('returns seed defaults for keys that have no row yet', async () => {
    const res = await request(app).get('/api/v1/admin/guide-config')
    expect(res.body.config['guide.v1.enabled']).toBe(true)
    expect(res.body.config['guide.rewards.hookComplete']).toBe(20)
    expect(res.body.config['guide.rewards.curriculumComplete']).toBe(50)
    expect(res.body.config['guide.quickBot.defaultTier']).toBe('novice')
    expect(res.body.config['guide.quickBot.firstTrainingTier']).toBe('intermediate')
    expect(res.body.config['guide.cup.sizeEntrants']).toBe(4)
    expect(res.body.config['guide.cup.retentionDays']).toBe(30)
    expect(res.body.config['guide.demo.ttlMinutes']).toBe(60)
    expect(res.body.config['metrics.internalEmailDomains']).toEqual([])
  })

  it('reflects stored values when present', async () => {
    getSystemConfig.mockImplementation((key, def) => {
      if (key === 'guide.rewards.hookComplete') return Promise.resolve(35)
      if (key === 'guide.v1.enabled')           return Promise.resolve(false)
      return Promise.resolve(def)
    })
    const res = await request(app).get('/api/v1/admin/guide-config')
    expect(res.body.config['guide.rewards.hookComplete']).toBe(35)
    expect(res.body.config['guide.v1.enabled']).toBe(false)
  })
})

describe('PATCH /api/v1/admin/guide-config — validation', () => {
  it('writes an integer reward and returns the updated map', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/guide-config')
      .send({ 'guide.rewards.hookComplete': 25 })
    expect(res.status).toBe(200)
    expect(setSystemConfig).toHaveBeenCalledWith('guide.rewards.hookComplete', 25)
    expect(Object.keys(res.body.config).length).toBe(13)
  })

  it('writes a boolean flag', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/guide-config')
      .send({ 'guide.v1.enabled': false })
    expect(res.status).toBe(200)
    expect(setSystemConfig).toHaveBeenCalledWith('guide.v1.enabled', false)
  })

  it('writes an enum tier', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/guide-config')
      .send({ 'guide.quickBot.defaultTier': 'advanced' })
    expect(res.status).toBe(200)
    expect(setSystemConfig).toHaveBeenCalledWith('guide.quickBot.defaultTier', 'advanced')
  })

  it('writes a string-array (trims, drops empties)', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/guide-config')
      .send({ 'metrics.internalEmailDomains': ['  callidity.com  ', '', 'example.com'] })
    expect(res.status).toBe(200)
    expect(setSystemConfig).toHaveBeenCalledWith('metrics.internalEmailDomains', ['callidity.com', 'example.com'])
  })

  it('rejects unknown keys with 400', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/guide-config')
      .send({ 'guide.does.not.exist': 1 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/unknown/i)
    expect(setSystemConfig).not.toHaveBeenCalled()
  })

  it('rejects writes to the reserved guide.cup.sizeEntrants', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/guide-config')
      .send({ 'guide.cup.sizeEntrants': 8 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/read-only/i)
    expect(setSystemConfig).not.toHaveBeenCalled()
  })

  it('rejects integer below min', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/guide-config')
      .send({ 'guide.cup.retentionDays': 0 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/>=\s*1/)
  })

  it('rejects integer above max', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/guide-config')
      .send({ 'guide.demo.ttlMinutes': 99999 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/<=\s*1440/)
  })

  it('rejects bad enum value', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/guide-config')
      .send({ 'guide.quickBot.defaultTier': 'godlike' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/one of/i)
  })

  it('rejects non-boolean for guide.v1.enabled (e.g. truthy string)', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/guide-config')
      .send({ 'guide.v1.enabled': 'true' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/boolean/i)
  })

  it('is all-or-nothing — one bad key blocks the whole batch', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/guide-config')
      .send({
        'guide.rewards.hookComplete': 25,           // valid
        'guide.quickBot.defaultTier': 'godlike',    // invalid
      })
    expect(res.status).toBe(400)
    expect(setSystemConfig).not.toHaveBeenCalled()
  })

  it('writes multiple valid keys in one batch', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/guide-config')
      .send({
        'guide.rewards.hookComplete':       25,
        'guide.rewards.curriculumComplete': 60,
        'guide.demo.ttlMinutes':            120,
      })
    expect(res.status).toBe(200)
    expect(setSystemConfig).toHaveBeenCalledWith('guide.rewards.hookComplete',       25)
    expect(setSystemConfig).toHaveBeenCalledWith('guide.rewards.curriculumComplete', 60)
    expect(setSystemConfig).toHaveBeenCalledWith('guide.demo.ttlMinutes',            120)
  })
})
