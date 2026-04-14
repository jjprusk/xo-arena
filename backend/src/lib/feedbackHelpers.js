// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Shared query/mutation helpers for feedback endpoints.
 * Used by both /support and /admin route handlers.
 */

import db from './db.js'

const VALID_SORTS = ['createdAt', 'status', 'category', 'appId']
const VALID_DIRS  = ['asc', 'desc']

/**
 * List feedback with filtering, pagination, and sorting.
 */
export async function listFeedback(query) {
  const {
    appId,
    status,
    category,
    archived = 'false',
    from,
    to,
    sort = 'createdAt',
    dir = 'desc',
    page = '1',
    limit = '20',
  } = query

  const pageNum  = Math.max(1, parseInt(page) || 1)
  const limitNum = Math.min(100, parseInt(limit) || 20)
  const skip = (pageNum - 1) * limitNum

  const sortField = VALID_SORTS.includes(sort) ? sort : 'createdAt'
  const sortDir   = VALID_DIRS.includes(dir) ? dir : 'desc'

  const where = {}
  if (appId)    where.appId    = appId
  if (status)   where.status   = status
  if (category) where.category = category

  // archived filter
  if (archived === 'true') {
    where.archivedAt = { not: null }
  } else {
    where.archivedAt = null
  }

  // date range on createdAt
  if (from || to) {
    where.createdAt = {}
    if (from) where.createdAt.gte = new Date(from)
    if (to)   where.createdAt.lte = new Date(to)
  }

  const [items, total] = await Promise.all([
    db.feedback.findMany({
      where,
      orderBy: { [sortField]: sortDir },
      skip,
      take: limitNum,
      include: {
        user:    { select: { id: true, displayName: true, email: true } },
        replies: { orderBy: { createdAt: 'asc' } },
      },
    }),
    db.feedback.count({ where }),
  ])

  // Attach admin display names to replies (single extra query for all unique admin IDs)
  const allAdminIds = [...new Set(items.flatMap(i => i.replies.map(r => r.adminId)))]
  let adminMap = {}
  if (allAdminIds.length) {
    const admins = await db.user.findMany({
      where: { id: { in: allAdminIds } },
      select: { id: true, displayName: true },
    })
    adminMap = Object.fromEntries(admins.map(a => [a.id, a.displayName ?? 'Staff']))
  }

  const itemsWithReplies = items.map(item => ({
    ...item,
    replies: item.replies.map(r => ({ ...r, adminName: adminMap[r.adminId] ?? 'Staff' })),
  }))

  return { items: itemsWithReplies, total, page: pageNum, limit: limitNum }
}

/**
 * Get unread count, optionally grouped by appId.
 */
export async function getUnreadCount(query) {
  const groupByApp = query.groupByApp === 'true' || query.groupByApp === true

  if (groupByApp) {
    const rows = await db.feedback.groupBy({
      by: ['appId'],
      where: { readAt: null, archivedAt: null },
      _count: { id: true },
    })
    const counts = Object.fromEntries(rows.map(r => [r.appId, r._count.id]))
    return { counts }
  }

  const count = await db.feedback.count({ where: { readAt: null, archivedAt: null } })
  return { count }
}

/**
 * Mark feedback as read (idempotent — only sets if not already set).
 */
export async function markRead(id) {
  const item = await db.feedback.findUnique({ where: { id }, select: { readAt: true } })
  if (!item) return null
  if (item.readAt) return item
  return db.feedback.update({ where: { id }, data: { readAt: new Date() } })
}

/**
 * Update feedback status.
 */
export async function updateStatus(id, { status, resolutionNote }, resolvedById) {
  const data = { status }
  if (resolutionNote !== undefined) data.resolutionNote = resolutionNote
  if (status === 'RESOLVED' || status === 'WONT_FIX') {
    data.resolvedAt    = new Date()
    data.resolvedById  = resolvedById
  }
  return db.feedback.update({ where: { id }, data })
}

/**
 * Toggle archive state on a single feedback item.
 */
export async function toggleArchive(id) {
  const item = await db.feedback.findUnique({ where: { id }, select: { archivedAt: true } })
  if (!item) return null
  return db.feedback.update({
    where: { id },
    data: { archivedAt: item.archivedAt ? null : new Date() },
  })
}

/**
 * Archive many feedback items by ID.
 */
export async function archiveMany(ids) {
  return db.feedback.updateMany({
    where: { id: { in: ids } },
    data: { archivedAt: new Date() },
  })
}

/**
 * Hard-delete a feedback item.
 */
export async function deleteFeedback(id) {
  return db.feedback.delete({ where: { id } })
}

/**
 * Create a reply on a feedback item.
 * Returns { reply, feedback, replies } or null if the item does not exist.
 * `replies` is the full ordered reply list for this item, each with an `adminName` field.
 */
export async function createReply(feedbackId, adminId, message) {
  const feedback = await db.feedback.findUnique({
    where: { id: feedbackId },
    select: {
      id:      true,
      message: true,
      user: {
        select: { id: true, displayName: true, email: true, betterAuthId: true },
      },
    },
  })
  if (!feedback) return null

  const reply = await db.feedbackReply.create({
    data: { feedbackId, adminId, message },
  })

  // Fetch all replies for this item (including the new one) with admin names
  const allReplies = await db.feedbackReply.findMany({
    where:   { feedbackId },
    orderBy: { createdAt: 'asc' },
  })
  const adminIds = [...new Set(allReplies.map(r => r.adminId))]
  const admins = adminIds.length
    ? await db.user.findMany({
        where:  { id: { in: adminIds } },
        select: { id: true, displayName: true },
      })
    : []
  const adminMap = Object.fromEntries(admins.map(a => [a.id, a.displayName ?? 'Staff']))
  const replies = allReplies.map(r => ({ ...r, adminName: adminMap[r.adminId] ?? 'Staff' }))

  return { reply, feedback, replies }
}
