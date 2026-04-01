import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
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

const {
  listFeedback,
  getUnreadCount,
  markRead,
  updateStatus,
  toggleArchive,
  archiveMany,
  deleteFeedback,
  createReply,
} = await import('../feedbackHelpers.js')
const db = (await import('../db.js')).default

const mockItem = {
  id:         'fb_1',
  appId:      'xo-arena',
  category:   'BUG',
  status:     'OPEN',
  readAt:     null,
  archivedAt: null,
  message:    'Bug report',
  pageUrl:    'https://xo-arena.app',
  createdAt:  new Date(),
  replies:    [],
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── listFeedback ──────────────────────────────────────────────────────────────

describe('listFeedback', () => {
  beforeEach(() => {
    db.feedback.findMany.mockResolvedValue([mockItem])
    db.feedback.count.mockResolvedValue(1)
  })

  it('returns items, total, page, and limit', async () => {
    const result = await listFeedback({})
    expect(result.items).toHaveLength(1)
    expect(result.total).toBe(1)
    expect(result.page).toBe(1)
    expect(result.limit).toBe(20)
  })

  it('calculates pagination skip correctly for page 2', async () => {
    await listFeedback({ page: '2', limit: '10' })
    expect(db.feedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 })
    )
  })

  it('clamps page to 1 when page < 1', async () => {
    await listFeedback({ page: '0' })
    expect(db.feedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 })
    )
  })

  it('caps limit at 100', async () => {
    await listFeedback({ limit: '999' })
    expect(db.feedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 })
    )
  })

  it('uses default limit 20 when not provided', async () => {
    await listFeedback({})
    expect(db.feedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 })
    )
  })

  it('filters by appId when provided', async () => {
    await listFeedback({ appId: 'xo-arena' })
    expect(db.feedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ appId: 'xo-arena' }) })
    )
  })

  it('filters by status when provided', async () => {
    await listFeedback({ status: 'OPEN' })
    expect(db.feedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'OPEN' }) })
    )
  })

  it('filters by category when provided', async () => {
    await listFeedback({ category: 'BUG' })
    expect(db.feedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ category: 'BUG' }) })
    )
  })

  it('filters to non-archived items by default (archivedAt: null)', async () => {
    await listFeedback({})
    const call = db.feedback.findMany.mock.calls[0][0]
    expect(call.where.archivedAt).toBeNull()
  })

  it('filters to archived items when archived=true (archivedAt: { not: null })', async () => {
    await listFeedback({ archived: 'true' })
    const call = db.feedback.findMany.mock.calls[0][0]
    expect(call.where.archivedAt).toEqual({ not: null })
  })

  it('applies date range filter with from/to', async () => {
    const from = '2024-01-01'
    const to   = '2024-12-31'
    await listFeedback({ from, to })
    const call = db.feedback.findMany.mock.calls[0][0]
    expect(call.where.createdAt.gte).toBeInstanceOf(Date)
    expect(call.where.createdAt.lte).toBeInstanceOf(Date)
  })

  it('applies only from when to is absent', async () => {
    await listFeedback({ from: '2024-01-01' })
    const call = db.feedback.findMany.mock.calls[0][0]
    expect(call.where.createdAt.gte).toBeInstanceOf(Date)
    expect(call.where.createdAt.lte).toBeUndefined()
  })

  it('uses createdAt sort by default', async () => {
    await listFeedback({})
    expect(db.feedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } })
    )
  })

  it('accepts valid sort field', async () => {
    await listFeedback({ sort: 'status', dir: 'asc' })
    expect(db.feedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { status: 'asc' } })
    )
  })

  it('falls back to createdAt for invalid sort field', async () => {
    await listFeedback({ sort: 'INVALID', dir: 'desc' })
    expect(db.feedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } })
    )
  })

  it('falls back to desc for invalid dir', async () => {
    await listFeedback({ sort: 'createdAt', dir: 'INVALID' })
    expect(db.feedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } })
    )
  })
})

// ── getUnreadCount ────────────────────────────────────────────────────────────

describe('getUnreadCount', () => {
  it('returns total count', async () => {
    db.feedback.count.mockResolvedValue(5)
    const result = await getUnreadCount({})
    expect(result).toEqual({ count: 5 })
    expect(db.feedback.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { readAt: null, archivedAt: null } })
    )
  })

  it('returns grouped counts when groupByApp is true string', async () => {
    db.feedback.groupBy.mockResolvedValue([
      { appId: 'xo-arena', _count: { id: 3 } },
      { appId: 'other',    _count: { id: 1 } },
    ])
    const result = await getUnreadCount({ groupByApp: 'true' })
    expect(result.counts).toBeDefined()
    expect(result.counts['xo-arena']).toBe(3)
    expect(result.counts['other']).toBe(1)
  })

  it('returns grouped counts when groupByApp is boolean true', async () => {
    db.feedback.groupBy.mockResolvedValue([
      { appId: 'xo-arena', _count: { id: 2 } },
    ])
    const result = await getUnreadCount({ groupByApp: true })
    expect(result.counts['xo-arena']).toBe(2)
  })

  it('returns { count } and not { counts } when groupByApp is false', async () => {
    db.feedback.count.mockResolvedValue(0)
    const result = await getUnreadCount({ groupByApp: 'false' })
    expect(result).toHaveProperty('count')
    expect(result).not.toHaveProperty('counts')
  })
})

// ── markRead ──────────────────────────────────────────────────────────────────

describe('markRead', () => {
  it('sets readAt when item exists and not already read', async () => {
    db.feedback.findUnique.mockResolvedValue({ readAt: null })
    db.feedback.update.mockResolvedValue({ ...mockItem, readAt: new Date() })
    const result = await markRead('fb_1')
    expect(db.feedback.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'fb_1' }, data: { readAt: expect.any(Date) } })
    )
    expect(result.readAt).toBeDefined()
  })

  it('is idempotent — returns existing item when already read (no update)', async () => {
    const readAt = new Date()
    db.feedback.findUnique.mockResolvedValue({ readAt })
    const result = await markRead('fb_1')
    expect(db.feedback.update).not.toHaveBeenCalled()
    expect(result.readAt).toBe(readAt)
  })

  it('returns null when id does not exist', async () => {
    db.feedback.findUnique.mockResolvedValue(null)
    const result = await markRead('missing')
    expect(result).toBeNull()
    expect(db.feedback.update).not.toHaveBeenCalled()
  })
})

// ── updateStatus ──────────────────────────────────────────────────────────────

describe('updateStatus', () => {
  it('updates the status field', async () => {
    db.feedback.update.mockResolvedValue({ ...mockItem, status: 'IN_PROGRESS' })
    const result = await updateStatus('fb_1', { status: 'IN_PROGRESS' }, 'ba_admin_1')
    expect(db.feedback.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'fb_1' }, data: expect.objectContaining({ status: 'IN_PROGRESS' }) })
    )
    expect(result.status).toBe('IN_PROGRESS')
  })

  it('sets resolvedAt and resolvedById for RESOLVED status', async () => {
    db.feedback.update.mockResolvedValue({ ...mockItem, status: 'RESOLVED' })
    await updateStatus('fb_1', { status: 'RESOLVED' }, 'ba_admin_1')
    const call = db.feedback.update.mock.calls[0][0]
    expect(call.data.resolvedAt).toBeInstanceOf(Date)
    expect(call.data.resolvedById).toBe('ba_admin_1')
  })

  it('sets resolvedAt and resolvedById for WONT_FIX status', async () => {
    db.feedback.update.mockResolvedValue({ ...mockItem, status: 'WONT_FIX' })
    await updateStatus('fb_1', { status: 'WONT_FIX' }, 'ba_admin_1')
    const call = db.feedback.update.mock.calls[0][0]
    expect(call.data.resolvedAt).toBeInstanceOf(Date)
    expect(call.data.resolvedById).toBe('ba_admin_1')
  })

  it('does NOT set resolvedAt for OPEN status', async () => {
    db.feedback.update.mockResolvedValue({ ...mockItem, status: 'OPEN' })
    await updateStatus('fb_1', { status: 'OPEN' }, 'ba_admin_1')
    const call = db.feedback.update.mock.calls[0][0]
    expect(call.data.resolvedAt).toBeUndefined()
    expect(call.data.resolvedById).toBeUndefined()
  })

  it('does NOT set resolvedAt for IN_PROGRESS status', async () => {
    db.feedback.update.mockResolvedValue({ ...mockItem, status: 'IN_PROGRESS' })
    await updateStatus('fb_1', { status: 'IN_PROGRESS' }, 'ba_admin_1')
    const call = db.feedback.update.mock.calls[0][0]
    expect(call.data.resolvedAt).toBeUndefined()
  })

  it('includes resolutionNote when provided', async () => {
    db.feedback.update.mockResolvedValue(mockItem)
    await updateStatus('fb_1', { status: 'RESOLVED', resolutionNote: 'Fixed' }, 'ba_admin_1')
    const call = db.feedback.update.mock.calls[0][0]
    expect(call.data.resolutionNote).toBe('Fixed')
  })

  it('does not include resolutionNote when undefined', async () => {
    db.feedback.update.mockResolvedValue(mockItem)
    await updateStatus('fb_1', { status: 'OPEN', resolutionNote: undefined }, 'ba_admin_1')
    const call = db.feedback.update.mock.calls[0][0]
    expect(call.data).not.toHaveProperty('resolutionNote')
  })
})

// ── toggleArchive ─────────────────────────────────────────────────────────────

describe('toggleArchive', () => {
  it('sets archivedAt when currently null', async () => {
    db.feedback.findUnique.mockResolvedValue({ archivedAt: null })
    db.feedback.update.mockResolvedValue({ ...mockItem, archivedAt: new Date() })
    const result = await toggleArchive('fb_1')
    const call = db.feedback.update.mock.calls[0][0]
    expect(call.data.archivedAt).toBeInstanceOf(Date)
    expect(result.archivedAt).toBeDefined()
  })

  it('clears archivedAt when currently set', async () => {
    db.feedback.findUnique.mockResolvedValue({ archivedAt: new Date() })
    db.feedback.update.mockResolvedValue({ ...mockItem, archivedAt: null })
    const result = await toggleArchive('fb_1')
    const call = db.feedback.update.mock.calls[0][0]
    expect(call.data.archivedAt).toBeNull()
    expect(result.archivedAt).toBeNull()
  })

  it('returns null when id does not exist', async () => {
    db.feedback.findUnique.mockResolvedValue(null)
    const result = await toggleArchive('missing')
    expect(result).toBeNull()
    expect(db.feedback.update).not.toHaveBeenCalled()
  })
})

// ── archiveMany ───────────────────────────────────────────────────────────────

describe('archiveMany', () => {
  it('calls updateMany with the correct ids and sets archivedAt', async () => {
    db.feedback.updateMany.mockResolvedValue({ count: 3 })
    const result = await archiveMany(['fb_1', 'fb_2', 'fb_3'])
    expect(db.feedback.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['fb_1', 'fb_2', 'fb_3'] } },
      data:  { archivedAt: expect.any(Date) },
    })
    expect(result.count).toBe(3)
  })

  it('works with a single id', async () => {
    db.feedback.updateMany.mockResolvedValue({ count: 1 })
    await archiveMany(['fb_1'])
    expect(db.feedback.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['fb_1'] } } })
    )
  })
})

// ── deleteFeedback ────────────────────────────────────────────────────────────

describe('deleteFeedback', () => {
  it('calls db.feedback.delete with the correct id', async () => {
    db.feedback.delete.mockResolvedValue(mockItem)
    const result = await deleteFeedback('fb_1')
    expect(db.feedback.delete).toHaveBeenCalledWith({ where: { id: 'fb_1' } })
    expect(result).toEqual(mockItem)
  })

  it('propagates errors from db.feedback.delete', async () => {
    const err = new Error('Record not found')
    err.code = 'P2025'
    db.feedback.delete.mockRejectedValue(err)
    await expect(deleteFeedback('missing')).rejects.toMatchObject({ code: 'P2025' })
  })
})

// ── createReply ───────────────────────────────────────────────────────────────

const mockFeedbackWithUser = {
  id:      'fb_1',
  message: 'Something is broken',
  user: {
    id:           'usr_2',
    displayName:  'Alice',
    email:        'alice@test.com',
    betterAuthId: 'ba_2',
  },
}

const mockReply = {
  id:         'rpl_1',
  feedbackId: 'fb_1',
  adminId:    'usr_admin',
  message:    'Thanks for the report!',
  createdAt:  new Date(),
}

describe('createReply', () => {
  beforeEach(() => {
    db.feedback.findUnique.mockResolvedValue(mockFeedbackWithUser)
    db.feedbackReply.create.mockResolvedValue(mockReply)
    db.feedbackReply.findMany.mockResolvedValue([mockReply])
    db.user.findMany.mockResolvedValue([{ id: 'usr_admin', displayName: 'Admin Joe' }])
  })

  it('returns null when feedback does not exist', async () => {
    db.feedback.findUnique.mockResolvedValue(null)
    const result = await createReply('missing', 'usr_admin', 'Hello')
    expect(result).toBeNull()
    expect(db.feedbackReply.create).not.toHaveBeenCalled()
  })

  it('creates a reply with correct feedbackId, adminId, message', async () => {
    await createReply('fb_1', 'usr_admin', 'Hello')
    expect(db.feedbackReply.create).toHaveBeenCalledWith({
      data: { feedbackId: 'fb_1', adminId: 'usr_admin', message: 'Hello' },
    })
  })

  it('returns { reply, feedback, replies }', async () => {
    const result = await createReply('fb_1', 'usr_admin', 'Hello')
    expect(result).toHaveProperty('reply')
    expect(result).toHaveProperty('feedback')
    expect(result).toHaveProperty('replies')
  })

  it('replies list includes adminName resolved from user table', async () => {
    const result = await createReply('fb_1', 'usr_admin', 'Hello')
    expect(result.replies[0].adminName).toBe('Admin Joe')
  })

  it('falls back to "Staff" when admin user not found', async () => {
    db.user.findMany.mockResolvedValue([])
    const result = await createReply('fb_1', 'usr_admin', 'Hello')
    expect(result.replies[0].adminName).toBe('Staff')
  })

  it('replies are ordered by createdAt asc (findMany called with orderBy)', async () => {
    await createReply('fb_1', 'usr_admin', 'Hello')
    expect(db.feedbackReply.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where:   { feedbackId: 'fb_1' },
        orderBy: { createdAt: 'asc' },
      })
    )
  })

  it('includes the feedback object with user field in result', async () => {
    const result = await createReply('fb_1', 'usr_admin', 'Hello')
    expect(result.feedback.user.email).toBe('alice@test.com')
  })

  it('handles multiple replies with mixed admin ids', async () => {
    const reply2 = { ...mockReply, id: 'rpl_2', adminId: 'usr_admin2' }
    db.feedbackReply.findMany.mockResolvedValue([mockReply, reply2])
    db.user.findMany.mockResolvedValue([
      { id: 'usr_admin',  displayName: 'Admin Joe' },
      { id: 'usr_admin2', displayName: 'Admin Sam' },
    ])
    const result = await createReply('fb_1', 'usr_admin', 'Hello')
    expect(result.replies).toHaveLength(2)
    expect(result.replies[0].adminName).toBe('Admin Joe')
    expect(result.replies[1].adminName).toBe('Admin Sam')
  })
})
