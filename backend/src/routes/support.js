/**
 * Support-facing endpoints for managing feedback and users.
 * All routes require SUPPORT or ADMIN role.
 */

import { Router } from 'express'
import { requireAuth, requireSupport } from '../middleware/auth.js'
import db from '../lib/db.js'
import logger from '../logger.js'
import {
  listFeedback,
  getUnreadCount,
  markRead,
  updateStatus,
  toggleArchive,
  archiveMany,
  deleteFeedback,
} from '../lib/feedbackHelpers.js'

const router = Router()
router.use(requireAuth, requireSupport)

// ─── Feedback ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/support/feedback
 */
router.get('/feedback', async (req, res, next) => {
  try {
    const result = await listFeedback(req.query)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/v1/support/feedback/unread-count
 */
router.get('/feedback/unread-count', async (req, res, next) => {
  try {
    const result = await getUnreadCount(req.query)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/v1/support/feedback/archive-many
 * Body: { ids: string[] }
 */
router.patch('/feedback/archive-many', async (req, res, next) => {
  try {
    const { ids } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' })
    }
    const result = await archiveMany(ids)
    res.json({ count: result.count })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/v1/support/feedback/:id/read
 */
router.patch('/feedback/:id/read', async (req, res, next) => {
  try {
    const item = await markRead(req.params.id)
    if (!item) return res.status(404).json({ error: 'Feedback not found' })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/v1/support/feedback/:id/status
 * Body: { status, resolutionNote? }
 */
router.patch('/feedback/:id/status', async (req, res, next) => {
  try {
    const { status, resolutionNote } = req.body
    if (!status) return res.status(400).json({ error: 'status is required' })
    const item = await updateStatus(req.params.id, { status, resolutionNote }, req.auth.userId)
    res.json({ feedback: item })
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Feedback not found' })
    next(err)
  }
})

/**
 * PATCH /api/v1/support/feedback/:id/archive
 * Toggle archived state.
 */
router.patch('/feedback/:id/archive', async (req, res, next) => {
  try {
    const item = await toggleArchive(req.params.id)
    if (!item) return res.status(404).json({ error: 'Feedback not found' })
    res.json({ archivedAt: item.archivedAt })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/v1/support/feedback/:id
 */
router.delete('/feedback/:id', async (req, res, next) => {
  try {
    await deleteFeedback(req.params.id)
    res.status(204).end()
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Feedback not found' })
    next(err)
  }
})

// ─── User management ─────────────────────────────────────────────────────────

/**
 * GET /api/v1/support/users?q=
 * Search users by name/email. Returns up to 20 results.
 */
router.get('/users', async (req, res, next) => {
  try {
    const q = req.query.q?.trim() || ''
    const where = {
      isBot: false,
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: 'insensitive' } },
              { email:       { contains: q, mode: 'insensitive' } },
              { username:    { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    const users = await db.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id:          true,
        displayName: true,
        email:       true,
        createdAt:   true,
        banned:      true,
        eloRating:   true,
      },
    })

    res.json({ users })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/v1/support/users/:id/ban
 * Body: { banned: boolean }
 */
router.patch('/users/:id/ban', async (req, res, next) => {
  try {
    const { banned } = req.body
    if (banned === undefined) return res.status(400).json({ error: 'banned is required' })
    const user = await db.user.update({
      where: { id: req.params.id },
      data:  { banned: Boolean(banned) },
      select: { id: true, banned: true },
    })
    res.json({ user })
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' })
    next(err)
  }
})

export default router
