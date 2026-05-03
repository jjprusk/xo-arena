/**
 * Integration tests for GET /classification/me
 *
 * Mounts the full Express app (app.js) via supertest so the route is exercised
 * through the real middleware stack: CORS → JSON → requireAuth → handler.
 *
 * Only @xo-arena/db and jose are mocked — everything else (app wiring, auth
 * middleware, route mounting order) runs as in production.
 *
 * Covers:
 * - 401 when no Authorization header
 * - 401 when token is malformed / fails verification
 * - 404 when betterAuthId maps to no user
 * - 404 when user has no classification record
 * - 200 with full classification payload (tier, merits, history)
 * - 500 on unexpected DB error (error doesn't leak internals)
 * - Route is mounted at /classification/me, NOT under /classification (admin prefix)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

// ─── Mock @xo-arena/db ────────────────────────────────────────────────────────

const mockDb = {
  user:                 { findUnique: vi.fn() },
  playerClassification: { findUnique: vi.fn() },
  jwks:                 { findUnique: vi.fn() },
  baUser:               { findUnique: vi.fn() },
}

vi.mock('@xo-arena/db', () => ({ default: mockDb }))

// ─── Mock jose ────────────────────────────────────────────────────────────────
// Lets us simulate both valid and invalid tokens without real key material.

const mockJwtVerify = vi.fn()
const mockImportJWK = vi.fn()

vi.mock('jose', () => ({
  jwtVerify:  mockJwtVerify,
  importJWK:  mockImportJWK,
}))

// ─── Mock logger ──────────────────────────────────────────────────────────────

vi.mock('../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ─── Import app AFTER mocks are in place ─────────────────────────────────────

const { default: app } = await import('../app.js')

// ─── Token helpers ────────────────────────────────────────────────────────────

/**
 * Build a fake Bearer token whose header encodes the given kid.
 * The middleware parses only the header segment; the rest is irrelevant for mocking.
 */
function fakeToken(kid = 'key_1') {
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid })).toString('base64url')
  return `Bearer ${header}.payload.sig`
}

/**
 * Wire mockDb and mockJwtVerify so that a token with kid='key_1' verifies as
 * the given betterAuthId.  Call once per test that needs a valid session.
 */
function mockValidAuth(betterAuthId = 'ba_user_1') {
  mockDb.jwks.findUnique.mockResolvedValue({ id: 'key_1', publicKey: '{}' })
  mockImportJWK.mockResolvedValue('crypto-key')
  mockJwtVerify.mockResolvedValue({ payload: { sub: betterAuthId } })
  // requireAuth also checks for bans via baUser lookup
  mockDb.baUser.findUnique.mockResolvedValue(null) // no ban record
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET /classification/me — integration (full app stack)', () => {

  // ── Auth guard ──────────────────────────────────────────────────────────────

  it('returns 401 with no Authorization header', async () => {
    const res = await request(app).get('/classification/me')
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/authentication required/i)
  })

  it('returns 401 when token header has no matching JWKS key', async () => {
    mockDb.jwks.findUnique.mockResolvedValue(null) // kid not found
    const res = await request(app)
      .get('/classification/me')
      .set('Authorization', fakeToken('unknown-kid'))
    expect(res.status).toBe(401)
  })

  it('returns 401 when jose throws during verification', async () => {
    mockDb.jwks.findUnique.mockResolvedValue({ id: 'key_1', publicKey: '{}' })
    mockImportJWK.mockResolvedValue('crypto-key')
    mockJwtVerify.mockRejectedValue(new Error('signature invalid'))
    const res = await request(app)
      .get('/classification/me')
      .set('Authorization', fakeToken())
    expect(res.status).toBe(401)
  })

  // ── Authenticated paths ─────────────────────────────────────────────────────

  it('returns 404 when betterAuthId maps to no internal user', async () => {
    mockValidAuth('ba_unknown')
    mockDb.user.findUnique.mockResolvedValue(null)

    const res = await request(app)
      .get('/classification/me')
      .set('Authorization', fakeToken())

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/user not found/i)
  })

  it('returns 404 when user has no classification record', async () => {
    mockValidAuth('ba_user_1')
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_db_1' })
    mockDb.playerClassification.findUnique.mockResolvedValue(null)

    const res = await request(app)
      .get('/classification/me')
      .set('Authorization', fakeToken())

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/no classification/i)
  })

  it('returns 200 with tier, merits, and history for a known player', async () => {
    const now = new Date().toISOString()
    mockValidAuth('ba_user_1')
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_db_1' })
    mockDb.playerClassification.findUnique.mockResolvedValue({
      id:     'class_1',
      userId: 'user_db_1',
      tier:   'VETERAN',
      merits: 7,
      history: [
        { id: 'h1', fromTier: 'CONTENDER', toTier: 'VETERAN', reason: 'promotion', createdAt: now },
      ],
    })

    const res = await request(app)
      .get('/classification/me')
      .set('Authorization', fakeToken())

    expect(res.status).toBe(200)
    expect(res.body.tier).toBe('VETERAN')
    expect(res.body.merits).toBe(7)
    expect(res.body.history).toHaveLength(1)
    expect(res.body.history[0].toTier).toBe('VETERAN')
  })

  it('passes the correct betterAuthId to the user lookup', async () => {
    mockValidAuth('ba_player_99')
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_db_99' })
    mockDb.playerClassification.findUnique.mockResolvedValue({
      id: 'class_99', userId: 'user_db_99', tier: 'ELITE', merits: 12, history: [],
    })

    await request(app)
      .get('/classification/me')
      .set('Authorization', fakeToken())

    expect(mockDb.user.findUnique).toHaveBeenCalledWith({
      where:  { betterAuthId: 'ba_player_99' },
      select: { id: true },
    })
    expect(mockDb.playerClassification.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user_db_99' } })
    )
  })

  it('returns 500 on unexpected DB error and does not leak internals', async () => {
    mockValidAuth('ba_user_1')
    mockDb.user.findUnique.mockRejectedValue(new Error('connection reset'))

    const res = await request(app)
      .get('/classification/me')
      .set('Authorization', fakeToken())

    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/internal server error/i)
    expect(JSON.stringify(res.body)).not.toContain('connection reset')
  })

  // ── Route isolation ─────────────────────────────────────────────────────────

  it('is not reachable under /classification/players (admin prefix)', async () => {
    // /classification/players requires TOURNAMENT_ADMIN — a plain auth token should 403, not reach /me logic
    mockValidAuth('ba_user_1')
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_db_1', roles: [] })

    const res = await request(app)
      .get('/classification/players')
      .set('Authorization', fakeToken())

    // Admin middleware fires — 403 (not 200 or 404)
    expect(res.status).toBe(403)
  })
})
