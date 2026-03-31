import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// JWT whose header decodes to {"alg":"EdDSA","kid":"kid_1"} and payload to {"sub":"user_123"}
const VALID_JWT = 'eyJhbGciOiJFZERTQSIsImtpZCI6ImtpZF8xIn0.eyJzdWIiOiJ1c2VyXzEyMyJ9.fakesig'

// ── mocks must be declared before any imports that use them ──────────────────

vi.mock('jose', () => ({
  jwtVerify: vi.fn(async () => ({ payload: { sub: 'user_123' } })),
  importJWK: vi.fn(async () => ({})),
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

// dynamic import after mocks so the module sees the mocked dependencies
const { requireAuth, optionalAuth, requireAdmin, requireTournament, isAdmin, isTournament } =
  await import('../auth.js')

import db from '../../lib/db.js'
import { jwtVerify } from 'jose'

// ── helpers ──────────────────────────────────────────────────────────────────

function makeApp(middleware) {
  const app = express()
  app.use(express.json())
  app.get('/test', middleware, (req, res) => {
    res.json({ auth: req.auth ?? null })
  })
  return app
}

function makeChainApp(...middlewares) {
  const app = express()
  app.use(express.json())
  app.get('/test', ...middlewares, (req, res) => {
    res.json({ ok: true, auth: req.auth ?? null })
  })
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  // Restore safe defaults after each test
  db.jwks.findUnique.mockResolvedValue({ id: 'kid_1', publicKey: '{}', createdAt: new Date() })
  db.user.findUnique.mockResolvedValue({ banned: false, userRoles: [] })
  db.baUser.findUnique.mockResolvedValue(null)
  jwtVerify.mockResolvedValue({ payload: { sub: 'user_123' } })
})

// ── requireAuth ──────────────────────────────────────────────────────────────

describe('requireAuth', () => {
  const app = makeApp(requireAuth)

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/test')
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/authentication required/i)
  })

  it('returns 401 when token has no dots (invalid JWT structure)', async () => {
    const res = await request(app).get('/test').set('Authorization', 'Bearer bad-token')
    expect(res.status).toBe(401)
  })

  it('returns 401 when jwtVerify rejects', async () => {
    jwtVerify.mockRejectedValueOnce(new Error('signature invalid'))
    const res = await request(app).get('/test').set('Authorization', `Bearer ${VALID_JWT}`)
    expect(res.status).toBe(401)
  })

  it('returns 401 when JWKS key is not found in db', async () => {
    db.jwks.findUnique.mockResolvedValueOnce(null)
    const res = await request(app).get('/test').set('Authorization', `Bearer ${VALID_JWT}`)
    expect(res.status).toBe(401)
  })

  it('passes with valid token and attaches req.auth', async () => {
    const res = await request(app).get('/test').set('Authorization', `Bearer ${VALID_JWT}`)
    expect(res.status).toBe(200)
    expect(res.body.auth).toMatchObject({ userId: 'user_123' })
  })

  it('returns 403 when user is banned', async () => {
    db.user.findUnique.mockResolvedValueOnce({ banned: true })
    const res = await request(app).get('/test').set('Authorization', `Bearer ${VALID_JWT}`)
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/suspended/i)
  })

  it('passes through when ban check throws (fail-open behaviour)', async () => {
    db.user.findUnique.mockRejectedValueOnce(new Error('db offline'))
    const res = await request(app).get('/test').set('Authorization', `Bearer ${VALID_JWT}`)
    expect(res.status).toBe(200)
  })
})

// ── optionalAuth ─────────────────────────────────────────────────────────────

describe('optionalAuth', () => {
  const app = makeApp(optionalAuth)

  it('allows guest requests (no token) and sets req.auth = null', async () => {
    const res = await request(app).get('/test')
    expect(res.status).toBe(200)
    expect(res.body.auth).toBeNull()
  })

  it('attaches req.auth when a valid token is provided', async () => {
    const res = await request(app).get('/test').set('Authorization', `Bearer ${VALID_JWT}`)
    expect(res.status).toBe(200)
    expect(res.body.auth).toMatchObject({ userId: 'user_123' })
  })

  it('sets req.auth = null when token verification fails (no 401)', async () => {
    jwtVerify.mockRejectedValueOnce(new Error('bad sig'))
    const res = await request(app).get('/test').set('Authorization', `Bearer ${VALID_JWT}`)
    expect(res.status).toBe(200)
    expect(res.body.auth).toBeNull()
  })
})

// ── isAdmin ───────────────────────────────────────────────────────────────────

describe('isAdmin', () => {
  it('returns true when baUser has role "admin"', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'admin' })
    db.user.findUnique.mockResolvedValue({ userRoles: [] })
    expect(await isAdmin('user_123')).toBe(true)
  })

  it('returns true when domain userRoles contains ADMIN', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'ADMIN' }] })
    expect(await isAdmin('user_123')).toBe(true)
  })

  it('returns false when user has no admin role', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [] })
    expect(await isAdmin('user_123')).toBe(false)
  })

  it('returns false when db throws', async () => {
    db.baUser.findUnique.mockRejectedValue(new Error('db error'))
    expect(await isAdmin('user_123')).toBe(false)
  })
})

// ── isTournament ──────────────────────────────────────────────────────────────

describe('isTournament', () => {
  it('returns true for admin baUser role', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'admin' })
    db.user.findUnique.mockResolvedValue({ userRoles: [] })
    expect(await isTournament('user_123')).toBe(true)
  })

  it('returns true for TOURNAMENT_ADMIN domain role', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'TOURNAMENT_ADMIN' }] })
    expect(await isTournament('user_123')).toBe(true)
  })

  it('returns true for ADMIN domain role', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'ADMIN' }] })
    expect(await isTournament('user_123')).toBe(true)
  })

  it('returns false when user has no qualifying role', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique.mockResolvedValue({ userRoles: [] })
    expect(await isTournament('user_123')).toBe(false)
  })

  it('returns false when db throws', async () => {
    db.baUser.findUnique.mockRejectedValue(new Error('db error'))
    expect(await isTournament('user_123')).toBe(false)
  })
})

// ── requireAdmin ──────────────────────────────────────────────────────────────

describe('requireAdmin', () => {
  it('returns 401 when req.auth is not set (no prior requireAuth)', async () => {
    // requireAdmin used standalone — req.auth is undefined
    const app = makeApp(requireAdmin)
    const res = await request(app).get('/test')
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/authentication required/i)
  })

  it('returns 403 when authenticated user is not an admin', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique
      // first call: ban check inside requireAuth
      .mockResolvedValueOnce({ banned: false, userRoles: [] })
      // second call: isAdmin domain check
      .mockResolvedValueOnce({ userRoles: [] })

    const app = makeChainApp(requireAuth, requireAdmin)
    const res = await request(app).get('/test').set('Authorization', `Bearer ${VALID_JWT}`)
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/admin/i)
  })

  it('passes when the user is an admin via baUser role', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'admin' })
    db.user.findUnique
      .mockResolvedValueOnce({ banned: false, userRoles: [] }) // ban check
      .mockResolvedValueOnce({ userRoles: [] })                // isAdmin domain check

    const app = makeChainApp(requireAuth, requireAdmin)
    const res = await request(app).get('/test').set('Authorization', `Bearer ${VALID_JWT}`)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('passes when the user has ADMIN domain role', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique
      .mockResolvedValueOnce({ banned: false, userRoles: [] })         // ban check
      .mockResolvedValueOnce({ userRoles: [{ role: 'ADMIN' }] })       // isAdmin domain check

    const app = makeChainApp(requireAuth, requireAdmin)
    const res = await request(app).get('/test').set('Authorization', `Bearer ${VALID_JWT}`)
    expect(res.status).toBe(200)
  })
})

// ── requireTournament ─────────────────────────────────────────────────────────

describe('requireTournament', () => {
  it('returns 401 when req.auth is not set', async () => {
    const app = makeApp(requireTournament)
    const res = await request(app).get('/test')
    expect(res.status).toBe(401)
  })

  it('returns 403 when user has no tournament role', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique
      .mockResolvedValueOnce({ banned: false, userRoles: [] }) // ban check
      .mockResolvedValueOnce({ userRoles: [] })                // isTournament domain check

    const app = makeChainApp(requireAuth, requireTournament)
    const res = await request(app).get('/test').set('Authorization', `Bearer ${VALID_JWT}`)
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/tournament/i)
  })

  it('passes for a user with TOURNAMENT_ADMIN role', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'user' })
    db.user.findUnique
      .mockResolvedValueOnce({ banned: false, userRoles: [] })
      .mockResolvedValueOnce({ userRoles: [{ role: 'TOURNAMENT_ADMIN' }] })

    const app = makeChainApp(requireAuth, requireTournament)
    const res = await request(app).get('/test').set('Authorization', `Bearer ${VALID_JWT}`)
    expect(res.status).toBe(200)
  })

  it('passes for a full admin user', async () => {
    db.baUser.findUnique.mockResolvedValue({ role: 'admin' })
    db.user.findUnique
      .mockResolvedValueOnce({ banned: false, userRoles: [] })
      .mockResolvedValueOnce({ userRoles: [] })

    const app = makeChainApp(requireAuth, requireTournament)
    const res = await request(app).get('/test').set('Authorization', `Bearer ${VALID_JWT}`)
    expect(res.status).toBe(200)
  })
})
