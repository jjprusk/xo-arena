/**
 * Tests for the feedback management endpoints added to admin.js.
 * Mounts admin.js at /api/v1/admin and uses a requireAdmin mock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.auth = { userId: 'ba_admin_1' }
    next()
  },
  requireAdmin: (req, _res, next) => {
    req.auth = { userId: 'ba_admin_1' }
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
      count:      vi.fn(),
    },
    baUser: {
      findUnique: vi.fn(),
      findMany:   vi.fn(),
      update:     vi.fn(),
    },
    game:    { count: vi.fn(), findMany: vi.fn() },
    mLModel: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    userRole: { create: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
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

vi.mock('../../services/skillService.js', () => ({
  deleteModel:     vi.fn(),
  getSystemConfig: vi.fn().mockResolvedValue(null),
  setSystemConfig: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../utils/roles.js', () => ({
  hasRole: vi.fn().mockReturnValue(false),
}))

vi.mock('../../logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

process.env.RESEND_API_KEY = 'test-key'

const adminRouter = (await import('../admin.js')).default
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
const db = (await import('../../lib/db.js')).default
const { Resend } = await import('resend')
const emailSend = Resend.mock.results[0]?.value?.emails?.send

const app = express()
app.use(express.json())
app.use('/api/v1/admin', adminRouter)

const mockFeedback = {
  id:         'fb_1',
  appId:      'xo-arena',
  category:   'BUG',
  status:     'OPEN',
  readAt:     null,
  archivedAt: null,
  message:    'Bug report',
  pageUrl:    'https://xo-arena.app',
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── GET /admin/feedback ───────────────────────────────────────────────────────

describe('GET /api/v1/admin/feedback', () => {
  it('requires admin and returns feedback list', async () => {
    listFeedback.mockResolvedValue({ items: [mockFeedback], total: 1, page: 1, limit: 20 })
    const res = await request(app).get('/api/v1/admin/feedback')
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(listFeedback).toHaveBeenCalled()
  })

  it('passes query filters to listFeedback', async () => {
    listFeedback.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 })
    await request(app).get('/api/v1/admin/feedback?status=OPEN&appId=xo-arena')
    expect(listFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'OPEN', appId: 'xo-arena' })
    )
  })
})

// ── GET /admin/feedback/unread-count ──────────────────────────────────────────

describe('GET /api/v1/admin/feedback/unread-count', () => {
  it('returns unread count', async () => {
    getUnreadCount.mockResolvedValue({ count: 7 })
    const res = await request(app).get('/api/v1/admin/feedback/unread-count')
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(7)
  })

  it('returns grouped counts when ?groupByApp=true', async () => {
    getUnreadCount.mockResolvedValue({ counts: { 'xo-arena': 4 } })
    const res = await request(app).get('/api/v1/admin/feedback/unread-count?groupByApp=true')
    expect(res.status).toBe(200)
    expect(res.body.counts).toBeDefined()
  })
})

// ── PATCH /admin/feedback/:id/read ────────────────────────────────────────────

describe('PATCH /api/v1/admin/feedback/:id/read', () => {
  it('marks feedback as read', async () => {
    markRead.mockResolvedValue({ ...mockFeedback, readAt: new Date().toISOString() })
    const res = await request(app).patch('/api/v1/admin/feedback/fb_1/read')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(markRead).toHaveBeenCalledWith('fb_1')
  })

  it('returns 404 when feedback not found', async () => {
    markRead.mockResolvedValue(null)
    const res = await request(app).patch('/api/v1/admin/feedback/missing/read')
    expect(res.status).toBe(404)
  })
})

// ── PATCH /admin/feedback/:id/status ─────────────────────────────────────────

describe('PATCH /api/v1/admin/feedback/:id/status', () => {
  it('updates status', async () => {
    updateStatus.mockResolvedValue({ ...mockFeedback, status: 'IN_PROGRESS' })
    const res = await request(app)
      .patch('/api/v1/admin/feedback/fb_1/status')
      .send({ status: 'IN_PROGRESS' })
    expect(res.status).toBe(200)
    expect(res.body.feedback.status).toBe('IN_PROGRESS')
    expect(updateStatus).toHaveBeenCalledWith('fb_1', { status: 'IN_PROGRESS', resolutionNote: undefined }, 'ba_admin_1')
  })

  it('returns 400 when status is missing', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feedback/fb_1/status')
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 404 when Prisma throws P2025', async () => {
    const err = new Error('Record not found')
    err.code = 'P2025'
    updateStatus.mockRejectedValue(err)
    const res = await request(app)
      .patch('/api/v1/admin/feedback/missing/status')
      .send({ status: 'OPEN' })
    expect(res.status).toBe(404)
  })
})

// ── PATCH /admin/feedback/:id/archive ────────────────────────────────────────

describe('PATCH /api/v1/admin/feedback/:id/archive', () => {
  it('toggles archive on (sets archivedAt)', async () => {
    const ts = new Date().toISOString()
    toggleArchive.mockResolvedValue({ ...mockFeedback, archivedAt: ts })
    const res = await request(app).patch('/api/v1/admin/feedback/fb_1/archive')
    expect(res.status).toBe(200)
    expect(res.body.archivedAt).toBe(ts)
    expect(toggleArchive).toHaveBeenCalledWith('fb_1')
  })

  it('toggles archive off (clears archivedAt)', async () => {
    toggleArchive.mockResolvedValue({ ...mockFeedback, archivedAt: null })
    const res = await request(app).patch('/api/v1/admin/feedback/fb_1/archive')
    expect(res.status).toBe(200)
    expect(res.body.archivedAt).toBeNull()
  })

  it('returns 404 when feedback not found', async () => {
    toggleArchive.mockResolvedValue(null)
    const res = await request(app).patch('/api/v1/admin/feedback/missing/archive')
    expect(res.status).toBe(404)
  })
})

// ── PATCH /admin/feedback/archive-many ───────────────────────────────────────

describe('PATCH /api/v1/admin/feedback/archive-many', () => {
  it('bulk archives by ids and returns count', async () => {
    archiveMany.mockResolvedValue({ count: 2 })
    const res = await request(app)
      .patch('/api/v1/admin/feedback/archive-many')
      .send({ ids: ['fb_1', 'fb_2'] })
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(2)
    expect(archiveMany).toHaveBeenCalledWith(['fb_1', 'fb_2'])
  })

  it('returns 400 when ids is empty', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feedback/archive-many')
      .send({ ids: [] })
    expect(res.status).toBe(400)
  })

  it('returns 400 when ids is missing', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feedback/archive-many')
      .send({})
    expect(res.status).toBe(400)
  })
})

// ── DELETE /admin/feedback/:id ────────────────────────────────────────────────

describe('DELETE /api/v1/admin/feedback/:id', () => {
  it('deletes feedback and returns 204', async () => {
    deleteFeedback.mockResolvedValue(mockFeedback)
    const res = await request(app).delete('/api/v1/admin/feedback/fb_1')
    expect(res.status).toBe(204)
    expect(deleteFeedback).toHaveBeenCalledWith('fb_1')
  })

  it('returns 404 when Prisma throws P2025', async () => {
    const err = new Error('Record not found')
    err.code = 'P2025'
    deleteFeedback.mockRejectedValue(err)
    const res = await request(app).delete('/api/v1/admin/feedback/missing')
    expect(res.status).toBe(404)
  })
})

// ── POST /admin/feedback/:id/reply ────────────────────────────────────────────

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

describe('POST /api/v1/admin/feedback/:id/reply', () => {
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
      .post('/api/v1/admin/feedback/fb_1/reply')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/message/i)
  })

  it('returns 400 when message is blank', async () => {
    const res = await request(app)
      .post('/api/v1/admin/feedback/fb_1/reply')
      .send({ message: '   ' })
    expect(res.status).toBe(400)
  })

  it('returns 404 when feedback not found', async () => {
    createReply.mockResolvedValue(null)
    const res = await request(app)
      .post('/api/v1/admin/feedback/missing/reply')
      .send({ message: 'Hello' })
    expect(res.status).toBe(404)
  })

  it('returns 403 when domain user not found', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const res = await request(app)
      .post('/api/v1/admin/feedback/fb_1/reply')
      .send({ message: 'Hello' })
    expect(res.status).toBe(403)
  })

  it('returns 201 with reply and replies list', async () => {
    const res = await request(app)
      .post('/api/v1/admin/feedback/fb_1/reply')
      .send({ message: 'Thanks for the report!' })
    expect(res.status).toBe(201)
    expect(res.body.reply.id).toBe('rpl_1')
    expect(res.body.replies).toHaveLength(1)
  })

  it('calls createReply with correct args', async () => {
    await request(app)
      .post('/api/v1/admin/feedback/fb_1/reply')
      .send({ message: 'Nice report' })
    expect(createReply).toHaveBeenCalledWith('fb_1', 'usr_admin', 'Nice report')
  })

  it('sends reply email when user has verified email', async () => {
    await request(app)
      .post('/api/v1/admin/feedback/fb_1/reply')
      .send({ message: 'Hello Alice' })
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
      .post('/api/v1/admin/feedback/fb_1/reply')
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
      .post('/api/v1/admin/feedback/fb_1/reply')
      .send({ message: 'Hello' })
    await new Promise(r => setImmediate(r))
    expect(emailSend).not.toHaveBeenCalled()
  })
})
