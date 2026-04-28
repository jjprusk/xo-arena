import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.auth = { userId: 'ba_user_1' }
    next()
  },
  // vi.fn() so authenticated describe block can call mockImplementationOnce
  optionalAuth: vi.fn((req, _res, next) => {
    req.auth = null
    next()
  }),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    feedback: {
      create:     vi.fn(),
      findMany:   vi.fn(),
      findUnique: vi.fn(),
      update:     vi.fn(),
      updateMany: vi.fn(),
      delete:     vi.fn(),
      count:      vi.fn(),
      groupBy:    vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findMany:   vi.fn(),
      update:     vi.fn(),
    },
    baUser: {
      findUnique: vi.fn(),
      findMany:   vi.fn(),
    },
    userRoles: { findMany: vi.fn() },
  },
}))

vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: { send: vi.fn().mockResolvedValue({ id: 'email_1' }) },
  })),
}))

// express-rate-limit is identity middleware in tests
vi.mock('express-rate-limit', () => ({
  default: () => (_req, _res, next) => next(),
}))

vi.mock('../../logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('../../lib/emailTemplates.js', () => ({
  thankYouTemplate:  vi.fn(() => '<html>thank you</html>'),
  staffAlertTemplate: vi.fn(() => '<html>staff alert</html>'),
}))

const { mockAppendToStream } = vi.hoisted(() => ({
  mockAppendToStream: vi.fn().mockResolvedValue('1-0'),
}))
vi.mock('../../lib/eventStream.js', () => ({ appendToStream: mockAppendToStream }))

// Must be set before feedback.js is imported so `new Resend(key)` is called
process.env.RESEND_API_KEY = 'test-key'

const feedbackRouter = (await import('../feedback.js')).default
const db = (await import('../../lib/db.js')).default
const { Resend } = await import('resend')
const { optionalAuth } = await import('../../middleware/auth.js')

// feedback.js calls `new Resend(key)` once at module load — capture the spy here
const emailSend = Resend.mock.results[0]?.value?.emails?.send

// Build a fresh app so we can attach a mock Socket.io instance
function makeApp() {
  const mockIo = { to: vi.fn().mockReturnThis(), emit: vi.fn() }
  const app = express()
  app.use(express.json())
  app.set('io', mockIo)
  app.use('/api/v1/feedback', feedbackRouter)
  return { app, mockIo }
}

const VALID_BODY = {
  message: 'This is great feedback',
  pageUrl: 'https://xo-arena.app/game',
}

const mockFeedback = {
  id:        'fb_1',
  appId:     'xo-arena',
  category:  'OTHER',
  message:   'This is great feedback',
  pageUrl:   'https://xo-arena.app/game',
  readAt:    null,
  archivedAt: null,
}

// Shared Resend instance captured from mock
beforeEach(() => {
  vi.clearAllMocks()
  emailSend?.mockClear()
  db.feedback.create.mockResolvedValue(mockFeedback)
  db.user.findMany.mockResolvedValue([])
  db.baUser.findMany.mockResolvedValue([])
})

// ── Validation ────────────────────────────────────────────────────────────────

describe('POST /api/v1/feedback — validation', () => {
  it('returns 400 when message is missing', async () => {
    const { app } = makeApp()
    const res = await request(app)
      .post('/api/v1/feedback')
      .send({ pageUrl: 'https://xo-arena.app' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/message/i)
  })

  it('returns 400 when pageUrl is missing', async () => {
    const { app } = makeApp()
    const res = await request(app)
      .post('/api/v1/feedback')
      .send({ message: 'hello' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/pageUrl/i)
  })

  it('returns 400 when both message and pageUrl are missing', async () => {
    const { app } = makeApp()
    const res = await request(app).post('/api/v1/feedback').send({})
    expect(res.status).toBe(400)
  })
})

// ── Anonymous submission ──────────────────────────────────────────────────────

describe('POST /api/v1/feedback — anonymous submission', () => {
  it('returns 201 and creates feedback with null userId', async () => {
    const { app } = makeApp()
    const res = await request(app).post('/api/v1/feedback').send(VALID_BODY)
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('fb_1')
    expect(db.feedback.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: null }) })
    )
  })

  it('does NOT look up a domain user for anonymous requests', async () => {
    const { app } = makeApp()
    await request(app).post('/api/v1/feedback').send(VALID_BODY)
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })
})

// ── Authenticated submission ──────────────────────────────────────────────────

describe('POST /api/v1/feedback — authenticated user', () => {
  // Override optionalAuth to simulate an authenticated user
  async function postAsUser(app, body = VALID_BODY) {
    // We need optionalAuth to set req.auth — re-mock it per test group via db mock:
    // The route calls db.user.findUnique when req.auth is truthy. We simulate by
    // patching the auth middleware for a specific app instance via a wrapper route.
    return request(app).post('/api/v1/feedback').send(body)
  }

  function makeAuthApp() {
    // Override optionalAuth for this one request to simulate a signed-in user
    optionalAuth.mockImplementationOnce((req, _res, next) => {
      req.auth = { userId: 'ba_user_1' }
      next()
    })
    return makeApp()
  }

  it('attaches userId when authenticated user is found', async () => {
    db.user.findUnique.mockResolvedValueOnce({
      id: 'usr_1', displayName: 'Alice', email: 'alice@example.com', betterAuthId: 'ba_user_1',
    })
    db.baUser.findUnique.mockResolvedValueOnce({ emailVerified: false })

    const { app } = makeAuthApp()
    const res = await postAsUser(app)
    expect(res.status).toBe(201)
    expect(db.feedback.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'usr_1' }) })
    )
  })

  it('sends thank-you email when user has verified email', async () => {
    db.user.findUnique.mockResolvedValueOnce({
      id: 'usr_1', displayName: 'Alice', email: 'alice@example.com', betterAuthId: 'ba_user_1',
    })
    db.baUser.findUnique.mockResolvedValueOnce({ emailVerified: true })

    const { app } = makeAuthApp()
    await postAsUser(app)

    // Wait for async fire-and-forget
    await new Promise(r => setTimeout(r, 10))
    const send = emailSend
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'alice@example.com' }))
  })

  it('does NOT send thank-you email when user email is not verified', async () => {
    db.user.findUnique.mockResolvedValueOnce({
      id: 'usr_1', displayName: 'Alice', email: 'alice@example.com', betterAuthId: 'ba_user_1',
    })
    db.baUser.findUnique.mockResolvedValueOnce({ emailVerified: false })

    const { app } = makeAuthApp()
    await postAsUser(app)
    await new Promise(r => setTimeout(r, 10))

    const send = emailSend
    // Staff alert may still be called — ensure thank-you was NOT the first call
    // (staff alert query returns [] so no staff emails either)
    expect(send).not.toHaveBeenCalled()
  })
})

// ── Anonymous — no thank-you email ───────────────────────────────────────────

describe('POST /api/v1/feedback — no thank-you for anonymous', () => {
  it('does NOT send thank-you email for anonymous submission', async () => {
    const { app } = makeApp()
    await request(app).post('/api/v1/feedback').send(VALID_BODY)
    await new Promise(r => setTimeout(r, 10))
    const send = emailSend
    expect(send).not.toHaveBeenCalled()
  })
})

// ── Realtime fan-out ─────────────────────────────────────────────────────────

describe('POST /api/v1/feedback — realtime fan-out', () => {
  beforeEach(() => { mockAppendToStream.mockClear() })

  it('emits feedback:new on Socket.io and SSE (Phase 4 dual-emit)', async () => {
    const { app, mockIo } = makeApp()
    await request(app).post('/api/v1/feedback').send(VALID_BODY)
    const expected = expect.objectContaining({
      id:       mockFeedback.id,
      category: mockFeedback.category,
      appId:    mockFeedback.appId,
      pageUrl:  mockFeedback.pageUrl,
    })

    // Legacy Socket.io path.
    expect(mockIo.to).toHaveBeenCalledWith('support')
    expect(mockIo.emit).toHaveBeenCalledWith('feedback:new', expected)

    // SSE dual-emit on the support: prefix.
    expect(mockAppendToStream).toHaveBeenCalledWith(
      'support:feedback:new',
      expected,
      { userId: '*' },
    )
  })
})

// ── Staff alert emails ────────────────────────────────────────────────────────

describe('POST /api/v1/feedback — staff alert emails', () => {
  it('sends staff alert emails to ADMIN/SUPPORT users with verified emails', async () => {
    const staffUser = { betterAuthId: 'ba_admin_1', email: 'admin@example.com', displayName: 'Admin' }
    db.user.findMany.mockResolvedValueOnce([staffUser])
    db.baUser.findMany.mockResolvedValueOnce([{ id: 'ba_admin_1' }]) // verified

    const { app } = makeApp()
    await request(app).post('/api/v1/feedback').send(VALID_BODY)
    await new Promise(r => setTimeout(r, 10))

    const send = emailSend
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@example.com' }))
  })

  it('does NOT send staff alert to users whose email is not verified', async () => {
    const staffUser = { betterAuthId: 'ba_staff_1', email: 'staff@example.com', displayName: 'Staff' }
    db.user.findMany.mockResolvedValueOnce([staffUser])
    db.baUser.findMany.mockResolvedValueOnce([]) // no verified ids

    const { app } = makeApp()
    await request(app).post('/api/v1/feedback').send(VALID_BODY)
    await new Promise(r => setTimeout(r, 10))

    const send = emailSend
    expect(send).not.toHaveBeenCalled()
  })
})

// ── Defaults ──────────────────────────────────────────────────────────────────

describe('POST /api/v1/feedback — defaults', () => {
  it('defaults appId to "xo-arena" when not provided', async () => {
    const { app } = makeApp()
    await request(app).post('/api/v1/feedback').send(VALID_BODY)
    expect(db.feedback.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ appId: 'xo-arena' }) })
    )
  })

  it('uses provided appId when supplied', async () => {
    const { app } = makeApp()
    await request(app)
      .post('/api/v1/feedback')
      .send({ ...VALID_BODY, appId: 'other-app' })
    expect(db.feedback.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ appId: 'other-app' }) })
    )
  })

  it('stores userAgent from request header when not in body', async () => {
    const { app } = makeApp()
    await request(app)
      .post('/api/v1/feedback')
      .set('User-Agent', 'TestBrowser/1.0')
      .send(VALID_BODY)
    expect(db.feedback.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userAgent: 'TestBrowser/1.0' }) })
    )
  })

  it('prefers userAgent from body over request header', async () => {
    const { app } = makeApp()
    await request(app)
      .post('/api/v1/feedback')
      .set('User-Agent', 'TestBrowser/1.0')
      .send({ ...VALID_BODY, userAgent: 'CustomAgent/2.0' })
    expect(db.feedback.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userAgent: 'CustomAgent/2.0' }) })
    )
  })
})
