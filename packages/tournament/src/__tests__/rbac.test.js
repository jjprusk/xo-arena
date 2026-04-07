/**
 * RBAC tests for tournament service middleware.
 *
 * Tests requireAuth and requireTournamentAdmin middleware directly using
 * mock req/res objects — no HTTP server needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock @xo-arena/db ────────────────────────────────────────────────────────

const mockDb = {
  jwks: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  baUser: { findUnique: vi.fn() },
}

vi.mock('@xo-arena/db', () => ({ default: mockDb }))

// ─── Mock jose ────────────────────────────────────────────────────────────────

const mockJwtVerify = vi.fn()
const mockImportJWK = vi.fn()
vi.mock('jose', () => ({
  jwtVerify: mockJwtVerify,
  importJWK: mockImportJWK,
}))

// ─── Import middleware AFTER mocks ────────────────────────────────────────────

const { requireAuth, requireTournamentAdmin, isTournamentAdmin } =
  await import('../middleware/auth.js')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRes() {
  const res = {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this },
    json(body) { this._body = body; return this },
  }
  return res
}

function makeReq(overrides = {}) {
  return {
    headers: {},
    auth: null,
    ...overrides,
  }
}

/**
 * Build a mock Bearer token with a known kid.
 * Base64url-encodes a fake JWT header — verifyToken extracts kid from it.
 */
function makeTokenHeader(kid = 'key_1') {
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid })).toString('base64url')
  return `Bearer ${header}.payload.sig`
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── requireAuth ──────────────────────────────────────────────────────────────

describe('requireAuth', () => {
  it('returns 401 when no Authorization header', async () => {
    const req = makeReq()
    const res = makeRes()
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(res._status).toBe(401)
    expect(res._body).toMatchObject({ error: 'Authentication required' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when Authorization header is not Bearer', async () => {
    const req = makeReq({ headers: { authorization: 'Basic abc123' } })
    const res = makeRes()
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(res._status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when JWKS key not found', async () => {
    mockDb.jwks.findUnique.mockResolvedValue(null)

    const req = makeReq({ headers: { authorization: makeTokenHeader('unknown_kid') } })
    const res = makeRes()
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(res._status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when JWT verification fails', async () => {
    mockDb.jwks.findUnique.mockResolvedValue({ id: 'key_1', publicKey: '{"kty":"OKP"}' })
    mockImportJWK.mockResolvedValue('mock-crypto-key')
    mockJwtVerify.mockRejectedValue(new Error('signature invalid'))

    const req = makeReq({ headers: { authorization: makeTokenHeader('key_1') } })
    const res = makeRes()
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(res._status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 403 when user is banned', async () => {
    mockDb.jwks.findUnique.mockResolvedValue({ id: 'key_1', publicKey: '{"kty":"OKP"}' })
    mockImportJWK.mockResolvedValue('mock-crypto-key')
    mockJwtVerify.mockResolvedValue({ payload: { sub: 'ba_user_1' } })
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1', banned: true })

    const req = makeReq({ headers: { authorization: makeTokenHeader('key_1') } })
    const res = makeRes()
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(res._status).toBe(403)
    expect(res._body).toMatchObject({ error: 'Account suspended' })
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next() and sets req.auth when token is valid', async () => {
    mockDb.jwks.findUnique.mockResolvedValue({ id: 'key_1', publicKey: '{"kty":"OKP"}' })
    mockImportJWK.mockResolvedValue('mock-crypto-key')
    mockJwtVerify.mockResolvedValue({ payload: { sub: 'ba_user_1' } })
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1', banned: false })

    const req = makeReq({ headers: { authorization: makeTokenHeader('key_1') } })
    const res = makeRes()
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(req.auth).toEqual({ userId: 'ba_user_1' })
  })
})

// ─── requireTournamentAdmin ───────────────────────────────────────────────────

describe('requireTournamentAdmin', () => {
  it('returns 403 when user has no admin role', async () => {
    mockDb.baUser.findUnique.mockResolvedValue({ role: 'user' })
    mockDb.user.findUnique.mockResolvedValue({ userRoles: [] })

    const req = makeReq({ auth: { userId: 'ba_user_1' } })
    const res = makeRes()
    const next = vi.fn()

    await requireTournamentAdmin(req, res, next)

    expect(res._status).toBe(403)
    expect(res._body).toMatchObject({ error: 'Tournament admin access required' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 403 when user has SUPPORT role but not TOURNAMENT_ADMIN or ADMIN', async () => {
    mockDb.baUser.findUnique.mockResolvedValue({ role: 'user' })
    mockDb.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'SUPPORT' }] })

    const req = makeReq({ auth: { userId: 'ba_user_1' } })
    const res = makeRes()
    const next = vi.fn()

    await requireTournamentAdmin(req, res, next)

    expect(res._status).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next() when user has TOURNAMENT_ADMIN role', async () => {
    mockDb.baUser.findUnique.mockResolvedValue({ role: 'user' })
    mockDb.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'TOURNAMENT_ADMIN' }] })

    const req = makeReq({ auth: { userId: 'ba_user_1' } })
    const res = makeRes()
    const next = vi.fn()

    await requireTournamentAdmin(req, res, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('calls next() when user has ADMIN role', async () => {
    mockDb.baUser.findUnique.mockResolvedValue({ role: 'user' })
    mockDb.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'ADMIN' }] })

    const req = makeReq({ auth: { userId: 'ba_user_1' } })
    const res = makeRes()
    const next = vi.fn()

    await requireTournamentAdmin(req, res, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('calls next() when baUser.role is admin', async () => {
    mockDb.baUser.findUnique.mockResolvedValue({ role: 'admin' })
    mockDb.user.findUnique.mockResolvedValue({ userRoles: [] })

    const req = makeReq({ auth: { userId: 'ba_user_1' } })
    const res = makeRes()
    const next = vi.fn()

    await requireTournamentAdmin(req, res, next)

    expect(next).toHaveBeenCalledOnce()
  })
})

// ─── isTournamentAdmin ────────────────────────────────────────────────────────

describe('isTournamentAdmin', () => {
  it('returns false when user has no roles', async () => {
    mockDb.baUser.findUnique.mockResolvedValue({ role: 'user' })
    mockDb.user.findUnique.mockResolvedValue({ userRoles: [] })
    expect(await isTournamentAdmin('ba_1')).toBe(false)
  })

  it('returns true for TOURNAMENT_ADMIN domain role', async () => {
    mockDb.baUser.findUnique.mockResolvedValue({ role: 'user' })
    mockDb.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'TOURNAMENT_ADMIN' }] })
    expect(await isTournamentAdmin('ba_1')).toBe(true)
  })

  it('returns true for ADMIN domain role', async () => {
    mockDb.baUser.findUnique.mockResolvedValue({ role: 'user' })
    mockDb.user.findUnique.mockResolvedValue({ userRoles: [{ role: 'ADMIN' }] })
    expect(await isTournamentAdmin('ba_1')).toBe(true)
  })

  it('returns true when baUser.role is admin', async () => {
    mockDb.baUser.findUnique.mockResolvedValue({ role: 'admin' })
    mockDb.user.findUnique.mockResolvedValue({ userRoles: [] })
    expect(await isTournamentAdmin('ba_1')).toBe(true)
  })

  it('returns false (does not throw) when db errors', async () => {
    mockDb.baUser.findUnique.mockRejectedValue(new Error('db down'))
    mockDb.user.findUnique.mockRejectedValue(new Error('db down'))
    expect(await isTournamentAdmin('ba_1')).toBe(false)
  })
})
