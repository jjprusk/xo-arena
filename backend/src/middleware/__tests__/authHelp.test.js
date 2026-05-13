/**
 * Tests for isHelpAdmin and requireHelpAdmin only. Mirrors authSupport.test.js
 * so the role-check matrix stays consistent across the four role middlewares.
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

const { isHelpAdmin, requireHelpAdmin } = await import('../auth.js')
import db from '../../lib/db.js'

function makeApp(middleware) {
  const app = express()
  app.use(express.json())
  app.get('/test', middleware, (req, res) => {
    res.json({ ok: true })
  })
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  db.jwks.findUnique.mockResolvedValue({ id: 'kid_1', publicKey: '{}', createdAt: new Date() })
  db.user.findUnique.mockResolvedValue({ banned: false, userRoles: [] })
  db.baUser.findUnique.mockResolvedValue(null)
})

describe('isHelpAdmin', () => {
  it('returns true for HELP_ADMIN domain role', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'HELP_ADMIN' }] })
    expect(await isHelpAdmin('user_123')).toBe(true)
  })

  it('returns true for ADMIN domain role (escalation)', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'ADMIN' }] })
    expect(await isHelpAdmin('user_123')).toBe(true)
  })

  it('returns true for BA admin role', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'admin' })
    db.user.findUnique.mockResolvedValue({ userRoles: [] })
    expect(await isHelpAdmin('user_123')).toBe(true)
  })

  it('returns false for SUPPORT-only', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'SUPPORT' }] })
    expect(await isHelpAdmin('user_123')).toBe(false)
  })

  it('returns false for BOT_ADMIN-only', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'BOT_ADMIN' }] })
    expect(await isHelpAdmin('user_123')).toBe(false)
  })

  it('returns false when user has no roles', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [] })
    expect(await isHelpAdmin('user_123')).toBe(false)
  })

  it('returns false when db throws', async () => {
    db.baUser.findUnique.mockRejectedValue(new Error('db offline'))
    expect(await isHelpAdmin('user_123')).toBe(false)
  })
})

describe('requireHelpAdmin', () => {
  it('calls next() for a HELP_ADMIN user', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'HELP_ADMIN' }] })

    const app = makeApp(async (req, res, next) => {
      req.auth = { userId: 'user_123' }
      await requireHelpAdmin(req, res, next)
    })
    const res = await request(app).get('/test')
    expect(res.status).toBe(200)
  })

  it('calls next() for an ADMIN user', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'ADMIN' }] })

    const app = makeApp(async (req, res, next) => {
      req.auth = { userId: 'user_123' }
      await requireHelpAdmin(req, res, next)
    })
    const res = await request(app).get('/test')
    expect(res.status).toBe(200)
  })

  it('returns 401 when req.auth is not set', async () => {
    const app = makeApp(requireHelpAdmin)
    const res = await request(app).get('/test')
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/authentication required/i)
  })

  it('returns 403 when user has SUPPORT but not HELP_ADMIN/ADMIN', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'SUPPORT' }] })

    const app = makeApp(async (req, res, next) => {
      req.auth = { userId: 'user_123' }
      await requireHelpAdmin(req, res, next)
    })
    const res = await request(app).get('/test')
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/help admin/i)
  })

  it('returns 403 when user has no roles', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [] })

    const app = makeApp(async (req, res, next) => {
      req.auth = { userId: 'user_123' }
      await requireHelpAdmin(req, res, next)
    })
    const res = await request(app).get('/test')
    expect(res.status).toBe(403)
  })
})
