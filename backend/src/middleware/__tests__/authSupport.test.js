/**
 * Tests for isSupport and requireSupport only.
 * The pre-existing auth.test.js covers requireAuth, optionalAuth, isAdmin, etc.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('jose', () => ({
  jwtVerify:  vi.fn(async () => ({ payload: { sub: 'user_123' } })),
  importJWK:  vi.fn(async () => ({})),
}))

vi.mock('../../lib/auth.js', () => ({ auth: {} }))

vi.mock('../../lib/db.js', () => ({
  default: {
    jwks: {
      findUnique: vi.fn(async () => ({ id: 'kid_1', publicKey: '{}', createdAt: new Date() })),
    },
    user: {
      findUnique: vi.fn(async () => ({ banned: false, userRoles: [] })),
    },
    baUser: {
      findUnique: vi.fn(async () => null),
    },
  },
}))

vi.mock('../../logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const { isSupport, requireSupport } = await import('../auth.js')
import db from '../../lib/db.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeApp(middleware) {
  const app = express()
  app.use(express.json())
  app.get('/test', middleware, (req, res) => {
    res.json({ ok: true, auth: req.auth ?? null })
  })
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  db.jwks.findUnique.mockResolvedValue({ id: 'kid_1', publicKey: '{}', createdAt: new Date() })
  db.user.findUnique.mockResolvedValue({ banned: false, userRoles: [] })
  db.baUser.findUnique.mockResolvedValue(null)
})

// ── isSupport ─────────────────────────────────────────────────────────────────

describe('isSupport', () => {
  it('returns true for SUPPORT domain role', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'SUPPORT' }] })
    expect(await isSupport('user_123')).toBe(true)
  })

  it('returns true for ADMIN domain role (escalation)', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'ADMIN' }] })
    expect(await isSupport('user_123')).toBe(true)
  })

  it('returns true for BA admin role', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'admin' })
    db.user.findUnique.mockResolvedValue({ userRoles: [] })
    expect(await isSupport('user_123')).toBe(true)
  })

  it('returns false for BOT_ADMIN domain role', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'BOT_ADMIN' }] })
    expect(await isSupport('user_123')).toBe(false)
  })

  it('returns false for TOURNAMENT_ADMIN domain role', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'TOURNAMENT_ADMIN' }] })
    expect(await isSupport('user_123')).toBe(false)
  })

  it('returns false when user has no roles', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [] })
    expect(await isSupport('user_123')).toBe(false)
  })

  it('returns false when user is not found in db', async () => {
    db.baUser.findUnique.mockResolvedValue(null)
    db.user.findUnique.mockResolvedValue(null)
    expect(await isSupport('nonexistent')).toBe(false)
  })

  it('returns false when db throws', async () => {
    db.baUser.findUnique.mockRejectedValue(new Error('db offline'))
    expect(await isSupport('user_123')).toBe(false)
  })
})

// ── requireSupport ────────────────────────────────────────────────────────────

describe('requireSupport', () => {
  it('calls next() for a SUPPORT user', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'SUPPORT' }] })

    const app = makeApp(async (req, res, next) => {
      req.auth = { userId: 'user_123' }
      await requireSupport(req, res, next)
    })
    const res = await request(app).get('/test')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('calls next() for an ADMIN user', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'ADMIN' }] })

    const app = makeApp(async (req, res, next) => {
      req.auth = { userId: 'user_123' }
      await requireSupport(req, res, next)
    })
    const res = await request(app).get('/test')
    expect(res.status).toBe(200)
  })

  it('calls next() for BA admin role', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'admin' })
    db.user.findUnique.mockResolvedValue({ userRoles: [] })

    const app = makeApp(async (req, res, next) => {
      req.auth = { userId: 'user_123' }
      await requireSupport(req, res, next)
    })
    const res = await request(app).get('/test')
    expect(res.status).toBe(200)
  })

  it('returns 401 when req.auth is not set', async () => {
    const app = makeApp(requireSupport)
    const res = await request(app).get('/test')
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/authentication required/i)
  })

  it('returns 403 when user has BOT_ADMIN but not SUPPORT/ADMIN', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'BOT_ADMIN' }] })

    const app = makeApp(async (req, res, next) => {
      req.auth = { userId: 'user_123' }
      await requireSupport(req, res, next)
    })
    const res = await request(app).get('/test')
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/support/i)
  })

  it('returns 403 when user has no roles', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [] })

    const app = makeApp(async (req, res, next) => {
      req.auth = { userId: 'user_123' }
      await requireSupport(req, res, next)
    })
    const res = await request(app).get('/test')
    expect(res.status).toBe(403)
  })
})
