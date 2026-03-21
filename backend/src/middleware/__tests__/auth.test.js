import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock better-auth lib/auth.js before importing the middleware
vi.mock('../../lib/auth.js', () => ({
  auth: {
    api: {
      verifyJWT: vi.fn(async ({ body: { token } }) => {
        if (token === 'valid-token') return { payload: { sub: 'user_123', aud: 'xo-arena' } }
        return { payload: null }
      }),
    },
  },
}))

// Mock db — no user is banned
vi.mock('../../lib/db.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(async () => ({ banned: false })),
    },
    baUser: {
      findUnique: vi.fn(async (query) => {
        if (query.where?.id === 'user_123') return { id: 'user_123', role: 'admin' }
        return null
      }),
    },
  },
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
    expect(res.body.auth).toMatchObject({ userId: 'user_123' })
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
    const res = await request(makeAdminApp()).get('/test').set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(200)
  })
})
