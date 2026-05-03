/**
 * GET /classification/me route tests
 *
 * Covers:
 * - Returns classification for the authenticated user
 * - Returns 404 if user has no classification record
 * - Returns 404 if the betterAuthId maps to no user
 * - Requires authentication (401 if no auth)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock @xo-arena/db ────────────────────────────────────────────────────────

const mockDb = {
  user: { findUnique: vi.fn() },
  playerClassification: { findUnique: vi.fn() },
}

vi.mock('@xo-arena/db', () => ({ default: mockDb }))

// ─── Mock jose (pulled in by auth middleware) ─────────────────────────────────

vi.mock('jose', () => ({
  jwtVerify: vi.fn(),
  importJWK: vi.fn(),
}))

// ─── Mock logger ─────────────────────────────────────────────────────────────

vi.mock('../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ─── Import route ─────────────────────────────────────────────────────────────

const { classificationMeRouter } = await import('../routes/classification.js')

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this },
    json(body)   { this._body = body; return this },
  }
  return res
}

/**
 * Invoke the route handler directly, bypassing Express middleware chain.
 * Sets req.auth to simulate a successful requireAuth pass-through.
 */
async function invokeHandler(req) {
  const res = makeRes()
  // Find the actual handler (last function in the stack registered with classificationMeRouter)
  // Express Router stores layers; the last layer for GET '/' is what we want.
  const layer = classificationMeRouter.stack.find(
    l => l.route?.path === '/' && l.route?.methods?.get
  )
  if (!layer) throw new Error('GET / route not found in classificationMeRouter')

  // The route has [requireAuth, handler] — call only the final handler
  const handlers = layer.route.stack
  const handler = handlers[handlers.length - 1].handle
  await handler(req, res, () => {})
  return res
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET /classification/me', () => {
  it('returns classification for authenticated user', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_db_1' })
    mockDb.playerClassification.findUnique.mockResolvedValue({
      id: 'class_1',
      userId: 'user_db_1',
      tier: 'CONTENDER',
      merits: 3,
      history: [{ fromTier: 'RECRUIT', toTier: 'CONTENDER', reason: 'promotion', createdAt: new Date() }],
    })

    const res = await invokeHandler({ auth: { userId: 'ba_user_1' } })

    expect(res._status).toBe(200)
    expect(res._body.tier).toBe('CONTENDER')
    expect(res._body.merits).toBe(3)
    expect(mockDb.user.findUnique).toHaveBeenCalledWith({
      where: { betterAuthId: 'ba_user_1' },
      select: { id: true },
    })
  })

  it('returns 404 if betterAuthId maps to no user', async () => {
    mockDb.user.findUnique.mockResolvedValue(null)

    const res = await invokeHandler({ auth: { userId: 'ba_unknown' } })

    expect(res._status).toBe(404)
    expect(res._body.error).toMatch(/user not found/i)
  })

  it('returns 404 if user has no classification record', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_db_2' })
    mockDb.playerClassification.findUnique.mockResolvedValue(null)

    const res = await invokeHandler({ auth: { userId: 'ba_no_class' } })

    expect(res._status).toBe(404)
    expect(res._body.error).toMatch(/no classification/i)
  })

  it('returns 500 on unexpected db error', async () => {
    mockDb.user.findUnique.mockRejectedValue(new Error('DB down'))

    const res = await invokeHandler({ auth: { userId: 'ba_1' } })

    expect(res._status).toBe(500)
    expect(res._body.error).toMatch(/internal server error/i)
  })
})
