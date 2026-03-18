import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock @clerk/backend before importing the middleware
vi.mock('@clerk/backend', () => ({
  createClerkClient: vi.fn(() => ({
    verifyToken: vi.fn(async (token) => {
      if (token === 'valid-token') return { sub: 'user_123', sid: 'sess_abc' }
      throw new Error('Invalid token')
    }),
    users: {
      getUser: vi.fn(async (userId) => {
        if (userId === 'user_123') return { publicMetadata: { role: 'admin' } }
        return { publicMetadata: {} }
      }),
    },
  })),
}))

const { requireAuth, optionalAuth, requireAdmin } = await import('../auth.js')

function makeApp(middleware) {
  const app = express()
  app.use(express.json())
  app.get('/test', middleware, (req, res) => {
    res.json({ auth: req.auth || null })
  })
  return app
}

describe('requireAuth', () => {
  const app = makeApp(requireAuth)

  it('returns 401 when no Authorization header', async () => {
    const res = await request(app).get('/test')
    expect(res.status).toBe(401)
  })

  it('returns 401 for invalid token', async () => {
    const res = await request(app).get('/test').set('Authorization', 'Bearer bad-token')
    expect(res.status).toBe(401)
  })

  it('passes through with valid token and attaches req.auth', async () => {
    const res = await request(app).get('/test').set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(200)
    expect(res.body.auth).toMatchObject({ userId: 'user_123', sessionId: 'sess_abc' })
  })
})

describe('optionalAuth', () => {
  const app = makeApp(optionalAuth)

  it('allows request with no token (guest)', async () => {
    const res = await request(app).get('/test')
    expect(res.status).toBe(200)
    expect(res.body.auth).toBeNull()
  })

  it('attaches auth when valid token provided', async () => {
    const res = await request(app).get('/test').set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(200)
    expect(res.body.auth.userId).toBe('user_123')
  })
})

describe('requireAdmin', () => {
  // requireAdmin must follow requireAuth
  function makeAdminApp() {
    const app = express()
    app.use(express.json())
    app.get('/test', requireAuth, requireAdmin, (req, res) => {
      res.json({ ok: true })
    })
    return app
  }

  it('allows admin user', async () => {
    const res = await makeAdminApp().inject?.('/test') ||
      await request(makeAdminApp()).get('/test').set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(200)
  })
})
