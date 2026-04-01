import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.auth = { userId: 'ba_support_1' }
    next()
  },
  requireSupport: (req, _res, next) => {
    req.auth = { userId: 'ba_support_1' }
    next()
  },
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
    feedbackReply: {
      create:   vi.fn(),
      findMany: vi.fn(),
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

vi.mock('../../lib/feedbackHelpers.js', () => ({
  listFeedback:   vi.fn(),
  getUnreadCount: vi.fn(),
  markRead:       vi.fn(),
  updateStatus:   vi.fn(),
  toggleArchive:  vi.fn(),
  archiveMany:    vi.fn(),
  deleteFeedback: vi.fn(),
  createReply:    vi.fn(),
}))

vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: { send: vi.fn().mockResolvedValue({ id: 'email_1' }) },
  })),
}))

vi.mock('../../logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

process.env.RESEND_API_KEY = 'test-key'

const supportRouter = (await import('../support.js')).default
const db = (await import('../../lib/db.js')).default
const {
  listFeedback,
  getUnreadCount,
  markRead,
  updateStatus,
  toggleArchive,
  archiveMany,
  deleteFeedback,
  createReply,
} = await import('../../lib/feedbackHelpers.js')
const { Resend } = await import('resend')
const emailSend = Resend.mock.results[0]?.value?.emails?.send

const app = express()
app.use(express.json())
app.use('/api/v1/support', supportRouter)

const mockFeedback = {
  id:         'fb_1',
  appId:      'xo-arena',
  category:   'BUG',
  status:     'OPEN',
  readAt:     null,
  archivedAt: null,
  message:    'Something is broken',
  pageUrl:    'https://xo-arena.app',
  createdAt:  new Date().toISOString(),
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── GET /feedback ─────────────────────────────────────────────────────────────

describe('GET /api/v1/support/feedback', () => {
  it('returns paginated feedback list', async () => {
    listFeedback.mockResolvedValue({ items: [mockFeedback], total: 1, page: 1, limit: 20 })
    const res = await request(app).get('/api/v1/support/feedback')
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.total).toBe(1)
    expect(listFeedback).toHaveBeenCalledWith(expect.any(Object))
  })

  it('passes query params to listFeedback', async () => {
    listFeedback.mockResolvedValue({ items: [], total: 0, page: 2, limit: 10 })
    await request(app).get('/api/v1/support/feedback?appId=xo-arena&status=OPEN&page=2&limit=10')
    expect(listFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'xo-arena', status: 'OPEN', page: '2', limit: '10' })
    )
  })

  it('passes category filter', async () => {
    listFeedback.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 })
    await request(app).get('/api/v1/support/feedback?category=BUG')
    expect(listFeedback).toHaveBeenCalledWith(expect.objectContaining({ category: 'BUG' }))
  })

  it('passes archived filter', async () => {
    listFeedback.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 })
    await request(app).get('/api/v1/support/feedback?archived=true')
    expect(listFeedback).toHaveBeenCalledWith(expect.objectContaining({ archived: 'true' }))
  })

  it('passes sort and dir params', async () => {
    listFeedback.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 })
    await request(app).get('/api/v1/support/feedback?sort=status&dir=asc')
    expect(listFeedback).toHaveBeenCalledWith(expect.objectContaining({ sort: 'status', dir: 'asc' }))
  })
})

// ── GET /feedback/unread-count ────────────────────────────────────────────────

describe('GET /api/v1/support/feedback/unread-count', () => {
  it('returns { count } by default', async () => {
    getUnreadCount.mockResolvedValue({ count: 5 })
    const res = await request(app).get('/api/v1/support/feedback/unread-count')
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(5)
  })

  it('returns { counts } when ?groupByApp=true', async () => {
    getUnreadCount.mockResolvedValue({ counts: { 'xo-arena': 3, 'other-app': 1 } })
    const res = await request(app).get('/api/v1/support/feedback/unread-count?groupByApp=true')
    expect(res.status).toBe(200)
    expect(res.body.counts).toBeDefined()
    expect(getUnreadCount).toHaveBeenCalledWith(expect.objectContaining({ groupByApp: 'true' }))
  })
})

// ── PATCH /feedback/:id/read ──────────────────────────────────────────────────

describe('PATCH /api/v1/support/feedback/:id/read', () => {
  it('marks feedback as read and returns { ok: true }', async () => {
    markRead.mockResolvedValue({ ...mockFeedback, readAt: new Date().toISOString() })
    const res = await request(app).patch('/api/v1/support/feedback/fb_1/read')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(markRead).toHaveBeenCalledWith('fb_1')
  })

  it('is idempotent — returns 200 even when already read', async () => {
    markRead.mockResolvedValue({ ...mockFeedback, readAt: new Date().toISOString() })
    const res = await request(app).patch('/api/v1/support/feedback/fb_1/read')
    expect(res.status).toBe(200)
  })

  it('returns 404 when feedback not found', async () => {
    markRead.mockResolvedValue(null)
    const res = await request(app).patch('/api/v1/support/feedback/nonexistent/read')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })
})

// ── PATCH /feedback/:id/status ────────────────────────────────────────────────

describe('PATCH /api/v1/support/feedback/:id/status', () => {
  it('updates status and returns updated feedback', async () => {
    const updated = { ...mockFeedback, status: 'IN_PROGRESS' }
    updateStatus.mockResolvedValue(updated)
    const res = await request(app)
      .patch('/api/v1/support/feedback/fb_1/status')
      .send({ status: 'IN_PROGRESS' })
    expect(res.status).toBe(200)
    expect(res.body.feedback.status).toBe('IN_PROGRESS')
    expect(updateStatus).toHaveBeenCalledWith('fb_1', { status: 'IN_PROGRESS', resolutionNote: undefined }, 'ba_support_1')
  })

  it('sets resolvedAt for RESOLVED status', async () => {
    const updated = { ...mockFeedback, status: 'RESOLVED', resolvedAt: new Date().toISOString() }
    updateStatus.mockResolvedValue(updated)
    const res = await request(app)
      .patch('/api/v1/support/feedback/fb_1/status')
      .send({ status: 'RESOLVED', resolutionNote: 'Fixed in v2' })
    expect(res.status).toBe(200)
    expect(updateStatus).toHaveBeenCalledWith(
      'fb_1',
      { status: 'RESOLVED', resolutionNote: 'Fixed in v2' },
      'ba_support_1'
    )
  })

  it('sets resolvedAt for WONT_FIX status', async () => {
    const updated = { ...mockFeedback, status: 'WONT_FIX', resolvedAt: new Date().toISOString() }
    updateStatus.mockResolvedValue(updated)
    const res = await request(app)
      .patch('/api/v1/support/feedback/fb_1/status')
      .send({ status: 'WONT_FIX' })
    expect(res.status).toBe(200)
    expect(updateStatus).toHaveBeenCalledWith('fb_1', { status: 'WONT_FIX', resolutionNote: undefined }, 'ba_support_1')
  })

  it('returns 400 when status is missing', async () => {
    const res = await request(app)
      .patch('/api/v1/support/feedback/fb_1/status')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/status/i)
  })

  it('returns 404 when Prisma throws P2025', async () => {
    const err = new Error('Record not found')
    err.code = 'P2025'
    updateStatus.mockRejectedValue(err)
    const res = await request(app)
      .patch('/api/v1/support/feedback/missing/status')
      .send({ status: 'OPEN' })
    expect(res.status).toBe(404)
  })
})

// ── PATCH /feedback/:id/archive ───────────────────────────────────────────────

describe('PATCH /api/v1/support/feedback/:id/archive', () => {
  it('archives an item (sets archivedAt)', async () => {
    const ts = new Date().toISOString()
    toggleArchive.mockResolvedValue({ ...mockFeedback, archivedAt: ts })
    const res = await request(app).patch('/api/v1/support/feedback/fb_1/archive')
    expect(res.status).toBe(200)
    expect(res.body.archivedAt).toBe(ts)
    expect(toggleArchive).toHaveBeenCalledWith('fb_1')
  })

  it('un-archives an item (clears archivedAt)', async () => {
    toggleArchive.mockResolvedValue({ ...mockFeedback, archivedAt: null })
    const res = await request(app).patch('/api/v1/support/feedback/fb_1/archive')
    expect(res.status).toBe(200)
    expect(res.body.archivedAt).toBeNull()
  })

  it('returns 404 when feedback not found', async () => {
    toggleArchive.mockResolvedValue(null)
    const res = await request(app).patch('/api/v1/support/feedback/missing/archive')
    expect(res.status).toBe(404)
  })
})

// ── PATCH /feedback/archive-many ─────────────────────────────────────────────

describe('PATCH /api/v1/support/feedback/archive-many', () => {
  it('bulk archives by ids array and returns count', async () => {
    archiveMany.mockResolvedValue({ count: 3 })
    const res = await request(app)
      .patch('/api/v1/support/feedback/archive-many')
      .send({ ids: ['fb_1', 'fb_2', 'fb_3'] })
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(3)
    expect(archiveMany).toHaveBeenCalledWith(['fb_1', 'fb_2', 'fb_3'])
  })

  it('returns 400 when ids is not an array', async () => {
    const res = await request(app)
      .patch('/api/v1/support/feedback/archive-many')
      .send({ ids: 'not-an-array' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when ids is an empty array', async () => {
    const res = await request(app)
      .patch('/api/v1/support/feedback/archive-many')
      .send({ ids: [] })
    expect(res.status).toBe(400)
  })
})

// ── DELETE /feedback/:id ──────────────────────────────────────────────────────

describe('DELETE /api/v1/support/feedback/:id', () => {
  it('deletes feedback and returns 204', async () => {
    deleteFeedback.mockResolvedValue(mockFeedback)
    const res = await request(app).delete('/api/v1/support/feedback/fb_1')
    expect(res.status).toBe(204)
    expect(deleteFeedback).toHaveBeenCalledWith('fb_1')
  })

  it('returns 404 when Prisma throws P2025', async () => {
    const err = new Error('Record not found')
    err.code = 'P2025'
    deleteFeedback.mockRejectedValue(err)
    const res = await request(app).delete('/api/v1/support/feedback/missing')
    expect(res.status).toBe(404)
  })
})

// ── GET /users ────────────────────────────────────────────────────────────────

describe('GET /api/v1/support/users', () => {
  const mockUsers = [
    { id: 'usr_1', displayName: 'Alice', email: 'alice@example.com', createdAt: new Date(), banned: false, eloRating: 1200 },
    { id: 'usr_2', displayName: 'Bob',   email: 'bob@example.com',   createdAt: new Date(), banned: false, eloRating: 1100 },
  ]

  it('returns a list of users', async () => {
    db.user.findMany.mockResolvedValue(mockUsers)
    const res = await request(app).get('/api/v1/support/users')
    expect(res.status).toBe(200)
    expect(res.body.users).toHaveLength(2)
  })

  it('passes search query to db.user.findMany', async () => {
    db.user.findMany.mockResolvedValue([mockUsers[0]])
    const res = await request(app).get('/api/v1/support/users?q=alice')
    expect(res.status).toBe(200)
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.any(Array) }),
      })
    )
  })

  it('does not add OR filter when query is empty', async () => {
    db.user.findMany.mockResolvedValue(mockUsers)
    await request(app).get('/api/v1/support/users')
    const call = db.user.findMany.mock.calls[0][0]
    expect(call.where).not.toHaveProperty('OR')
    expect(call.where.isBot).toBe(false)
  })

  it('limits results to 20', async () => {
    db.user.findMany.mockResolvedValue([])
    await request(app).get('/api/v1/support/users')
    const call = db.user.findMany.mock.calls[0][0]
    expect(call.take).toBe(20)
  })
})

// ── PATCH /users/:id/ban ──────────────────────────────────────────────────────

describe('PATCH /api/v1/support/users/:id/ban', () => {
  it('bans a user', async () => {
    db.user.update.mockResolvedValue({ id: 'usr_1', banned: true })
    const res = await request(app)
      .patch('/api/v1/support/users/usr_1/ban')
      .send({ banned: true })
    expect(res.status).toBe(200)
    expect(res.body.user.banned).toBe(true)
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'usr_1' }, data: { banned: true } })
    )
  })

  it('unbans a user', async () => {
    db.user.update.mockResolvedValue({ id: 'usr_1', banned: false })
    const res = await request(app)
      .patch('/api/v1/support/users/usr_1/ban')
      .send({ banned: false })
    expect(res.status).toBe(200)
    expect(res.body.user.banned).toBe(false)
  })

  it('returns 400 when banned field is missing', async () => {
    const res = await request(app)
      .patch('/api/v1/support/users/usr_1/ban')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/banned/i)
  })

  it('returns 404 when user not found (P2025)', async () => {
    const err = new Error('Record not found')
    err.code = 'P2025'
    db.user.update.mockRejectedValue(err)
    const res = await request(app)
      .patch('/api/v1/support/users/missing/ban')
      .send({ banned: true })
    expect(res.status).toBe(404)
  })
})

// ── POST /feedback/:id/reply ──────────────────────────────────────────────────

const mockReply = {
  id:         'rpl_1',
  feedbackId: 'fb_1',
  adminId:    'usr_admin',
  adminName:  'Admin Joe',
  message:    'Thanks for the report!',
  createdAt:  new Date().toISOString(),
}

const mockReplyFeedback = {
  id:      'fb_1',
  message: 'Something is broken',
  user: {
    id:           'usr_2',
    displayName:  'Alice',
    email:        'alice@test.com',
    betterAuthId: 'ba_2',
  },
}

describe('POST /api/v1/support/feedback/:id/reply', () => {
  beforeEach(() => {
    db.user.findUnique.mockResolvedValue({ id: 'usr_admin', displayName: 'Admin Joe' })
    createReply.mockResolvedValue({
      reply:    mockReply,
      feedback: mockReplyFeedback,
      replies:  [mockReply],
    })
    db.baUser.findUnique.mockResolvedValue({ emailVerified: true })
  })

  it('returns 400 when message is missing', async () => {
    const res = await request(app)
      .post('/api/v1/support/feedback/fb_1/reply')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/message/i)
  })

  it('returns 400 when message is blank', async () => {
    const res = await request(app)
      .post('/api/v1/support/feedback/fb_1/reply')
      .send({ message: '   ' })
    expect(res.status).toBe(400)
  })

  it('returns 404 when feedback not found', async () => {
    createReply.mockResolvedValue(null)
    const res = await request(app)
      .post('/api/v1/support/feedback/missing/reply')
      .send({ message: 'Hello' })
    expect(res.status).toBe(404)
  })

  it('returns 403 when domain user not found', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const res = await request(app)
      .post('/api/v1/support/feedback/fb_1/reply')
      .send({ message: 'Hello' })
    expect(res.status).toBe(403)
  })

  it('returns 201 with reply and replies list', async () => {
    const res = await request(app)
      .post('/api/v1/support/feedback/fb_1/reply')
      .send({ message: 'Thanks for the report!' })
    expect(res.status).toBe(201)
    expect(res.body.reply.id).toBe('rpl_1')
    expect(res.body.replies).toHaveLength(1)
  })

  it('calls createReply with correct args', async () => {
    await request(app)
      .post('/api/v1/support/feedback/fb_1/reply')
      .send({ message: 'Nice report' })
    expect(createReply).toHaveBeenCalledWith('fb_1', 'usr_admin', 'Nice report')
  })

  it('sends reply email when user has verified email', async () => {
    await request(app)
      .post('/api/v1/support/feedback/fb_1/reply')
      .send({ message: 'Hello Alice' })
    // Allow the non-fatal async email to fire
    await new Promise(r => setImmediate(r))
    expect(emailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to:      'alice@test.com',
        subject: expect.stringContaining('reply'),
      })
    )
  })

  it('does not send email when user email is unverified', async () => {
    db.baUser.findUnique.mockResolvedValue({ emailVerified: false })
    await request(app)
      .post('/api/v1/support/feedback/fb_1/reply')
      .send({ message: 'Hello' })
    await new Promise(r => setImmediate(r))
    expect(emailSend).not.toHaveBeenCalled()
  })

  it('does not send email for anonymous feedback (no user)', async () => {
    createReply.mockResolvedValue({
      reply:    mockReply,
      feedback: { ...mockReplyFeedback, user: null },
      replies:  [mockReply],
    })
    await request(app)
      .post('/api/v1/support/feedback/fb_1/reply')
      .send({ message: 'Hello' })
    await new Promise(r => setImmediate(r))
    expect(emailSend).not.toHaveBeenCalled()
  })
})
