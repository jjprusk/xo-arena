import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.auth = { userId: 'ba_user_1' }
    next()
  },
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    user: { findUnique: vi.fn() },
    pushSubscription: {
      upsert:     vi.fn(),
      deleteMany: vi.fn(),
      findMany:   vi.fn(),
    },
  },
}))

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const db = (await import('../../lib/db.js')).default
const pushRouter = (await import('../push.js')).default

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/push', pushRouter)
  return app
}

beforeEach(() => {
  vi.resetAllMocks()
  db.user.findUnique.mockResolvedValue({ id: 'u1' })
})

describe('GET /api/v1/push/public-key', () => {
  it('returns the VAPID public key when configured', async () => {
    process.env.VAPID_PUBLIC_KEY = 'the-public-key'
    const res = await request(makeApp()).get('/api/v1/push/public-key')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ publicKey: 'the-public-key' })
  })

  it('returns 503 when not configured', async () => {
    delete process.env.VAPID_PUBLIC_KEY
    const res = await request(makeApp()).get('/api/v1/push/public-key')
    expect(res.status).toBe(503)
  })
})

describe('POST /api/v1/push/subscribe', () => {
  it('400 when endpoint is missing', async () => {
    const res = await request(makeApp())
      .post('/api/v1/push/subscribe')
      .send({ keys: { p256dh: 'x', auth: 'y' } })
    expect(res.status).toBe(400)
  })

  it('400 when keys are incomplete', async () => {
    const res = await request(makeApp())
      .post('/api/v1/push/subscribe')
      .send({ endpoint: 'https://e', keys: { p256dh: 'x' } })
    expect(res.status).toBe(400)
  })

  it('upserts subscription and returns id', async () => {
    db.pushSubscription.upsert.mockResolvedValue({ id: 'sub_1' })
    const res = await request(makeApp())
      .post('/api/v1/push/subscribe')
      .send({
        endpoint:  'https://push.example/abc',
        keys:      { p256dh: 'pk', auth: 'ak' },
        userAgent: 'TestAgent/1.0',
      })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 'sub_1' })
    expect(db.pushSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { endpoint: 'https://push.example/abc' },
      create: expect.objectContaining({ userId: 'u1', p256dh: 'pk', auth: 'ak', userAgent: 'TestAgent/1.0' }),
    }))
  })

  it('404 when the authenticated session has no app user', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const res = await request(makeApp())
      .post('/api/v1/push/subscribe')
      .send({ endpoint: 'https://e', keys: { p256dh: 'x', auth: 'y' } })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v1/push/subscribe', () => {
  it('400 when endpoint missing', async () => {
    const res = await request(makeApp())
      .delete('/api/v1/push/subscribe')
      .send({})
    expect(res.status).toBe(400)
  })

  it('deletes by endpoint for the authenticated user only', async () => {
    db.pushSubscription.deleteMany.mockResolvedValue({ count: 1 })
    const res = await request(makeApp())
      .delete('/api/v1/push/subscribe')
      .send({ endpoint: 'https://push.example/abc' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ removed: 1 })
    expect(db.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', endpoint: 'https://push.example/abc' },
    })
  })
})

describe('GET /api/v1/push/subscriptions', () => {
  it('returns the subscriptions list for the user', async () => {
    db.pushSubscription.findMany.mockResolvedValue([
      { id: 's1', endpoint: 'https://e1', userAgent: 'UA1', createdAt: new Date(), lastUsedAt: new Date() },
    ])
    const res = await request(makeApp()).get('/api/v1/push/subscriptions')
    expect(res.status).toBe(200)
    expect(res.body.subscriptions).toHaveLength(1)
    expect(res.body.subscriptions[0]).toMatchObject({ id: 's1', endpoint: 'https://e1' })
  })
})
