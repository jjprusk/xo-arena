// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../lib/db.js', () => ({
  default: {
    perfVital: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  },
}))
vi.mock('../../logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import db from '../../lib/db.js'
import perfVitalsRouter from '../perfVitals.js'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/perf', perfVitalsRouter)
  return app
}

const validBody = ({ overrides = {}, vitalsOverrides = [] } = {}) => ({
  sessionId:      'sess_abcdef0123456789',
  deviceClass:    'mobile',
  effectiveType:  '4g',
  releaseVersion: '1.4.0-alpha-1.0',
  userAgent:      'Mozilla/5.0 fake',
  vitals: vitalsOverrides.length ? vitalsOverrides : [
    { name: 'FCP',  value: 612.3,   rating: 'good',              route: '/' },
    { name: 'LCP',  value: 1234.7,  rating: 'good',              route: '/' },
    { name: 'INP',  value: 88,      rating: 'good',              route: '/' },
    { name: 'CLS',  value: 0.04,    rating: 'good',              route: '/' },
    { name: 'TTFB', value: 188,     rating: 'good',              route: '/' },
  ],
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/v1/perf/vitals', () => {
  it('persists a well-formed beacon and returns 204', async () => {
    const res = await request(makeApp()).post('/api/v1/perf/vitals').send(validBody())
    expect(res.status).toBe(204)
    expect(db.perfVital.createMany).toHaveBeenCalledTimes(1)
    const arg = db.perfVital.createMany.mock.calls[0][0]
    expect(arg.data).toHaveLength(5)
    expect(arg.data[0]).toMatchObject({
      sessionId:    'sess_abcdef0123456789',
      deviceClass:  'mobile',
      name:         'FCP',
      route:        '/',
      rating:       'good',
    })
    expect(arg.data[0].env).toBeDefined()
  })

  it('drops unknown vital names but keeps the valid ones', async () => {
    const res = await request(makeApp()).post('/api/v1/perf/vitals').send(validBody({
      vitalsOverrides: [
        { name: 'FCP',     value: 600, route: '/' },
        { name: 'BOGUS',   value: 999, route: '/' },
        { name: 'LCP',     value: 800, route: '/' },
      ],
    }))
    expect(res.status).toBe(204)
    expect(db.perfVital.createMany).toHaveBeenCalledTimes(1)
    const data = db.perfVital.createMany.mock.calls[0][0].data
    expect(data.map(d => d.name).sort()).toEqual(['FCP', 'LCP'])
  })

  it('coerces unknown deviceClass to "unknown"', async () => {
    await request(makeApp()).post('/api/v1/perf/vitals').send(validBody({
      overrides: { deviceClass: 'flying-saucer' },
    }))
    const data = db.perfVital.createMany.mock.calls[0][0].data
    expect(data.every(d => d.deviceClass === 'unknown')).toBe(true)
  })

  it('persists a valid cohort and drops invalid ones (F11.5)', async () => {
    // Allowed: 'first-visit' | 'returning' | 'unknown'.
    await request(makeApp()).post('/api/v1/perf/vitals').send(validBody({
      overrides: { cohort: 'first-visit' },
    }))
    expect(db.perfVital.createMany.mock.calls[0][0].data[0].cohort).toBe('first-visit')

    db.perfVital.createMany.mockClear()
    await request(makeApp()).post('/api/v1/perf/vitals').send(validBody({
      overrides: { cohort: 'returning' },
    }))
    expect(db.perfVital.createMany.mock.calls[0][0].data[0].cohort).toBe('returning')

    db.perfVital.createMany.mockClear()
    await request(makeApp()).post('/api/v1/perf/vitals').send(validBody({
      overrides: { cohort: 'spy' },           // invalid → null (don't pollute the column)
    }))
    expect(db.perfVital.createMany.mock.calls[0][0].data[0].cohort).toBeNull()
  })

  it('drops vitals with non-finite or out-of-range values', async () => {
    await request(makeApp()).post('/api/v1/perf/vitals').send(validBody({
      vitalsOverrides: [
        { name: 'FCP', value: Infinity,    route: '/' },
        { name: 'LCP', value: -50,         route: '/' },
        { name: 'INP', value: 1e9,         route: '/' },
        { name: 'TTFB', value: 188,        route: '/x' },
      ],
    }))
    const data = db.perfVital.createMany.mock.calls[0][0].data
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({ name: 'TTFB', value: 188, route: '/x' })
  })

  it('returns 204 without calling DB when sessionId is missing', async () => {
    const res = await request(makeApp()).post('/api/v1/perf/vitals').send({
      ...validBody(),
      sessionId: '',
    })
    expect(res.status).toBe(204)
    expect(db.perfVital.createMany).not.toHaveBeenCalled()
  })

  it('returns 204 without calling DB when vitals is empty', async () => {
    const res = await request(makeApp())
      .post('/api/v1/perf/vitals')
      .send({ sessionId: 'sess_x', vitals: [] })
    expect(res.status).toBe(204)
    expect(db.perfVital.createMany).not.toHaveBeenCalled()
  })

  it('caps beacon at 32 vitals', async () => {
    const overflow = Array.from({ length: 33 }, () => ({ name: 'FCP', value: 100, route: '/' }))
    const res = await request(makeApp()).post('/api/v1/perf/vitals').send(validBody({
      vitalsOverrides: overflow,
    }))
    expect(res.status).toBe(204)
    expect(db.perfVital.createMany).not.toHaveBeenCalled()
  })

  it('returns 204 (not 5xx) even when the DB write fails', async () => {
    db.perfVital.createMany.mockRejectedValueOnce(new Error('connection lost'))
    const res = await request(makeApp()).post('/api/v1/perf/vitals').send(validBody())
    expect(res.status).toBe(204)
  })
})
