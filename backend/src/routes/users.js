import { Router } from 'express'
import { requireAuth, optionalAuth } from '../middleware/auth.js'
import { getUserById, updateUser, getUserStats, syncUser } from '../services/userService.js'
import { createClerkClient } from '@clerk/backend'
import db from '../lib/db.js'
import logger from '../logger.js'

const router = Router()

function clerk() {
  return createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
}

/**
 * POST /api/v1/users/sync
 * Called by the frontend after login to ensure the user exists in our DB.
 * Requires auth.
 */
router.post('/sync', requireAuth, async (req, res, next) => {
  try {
    const clerkUser = await clerk().users.getUser(req.auth.userId)
    const primaryEmail = clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
    const oauthProvider = clerkUser.externalAccounts?.[0]?.provider || 'email'

    const user = await syncUser({
      clerkId: clerkUser.id,
      email: primaryEmail?.emailAddress || '',
      username: clerkUser.username || clerkUser.id,
      displayName: clerkUser.fullName || clerkUser.username || 'Player',
      oauthProvider,
      avatarUrl: clerkUser.imageUrl || null,
    })

    res.json({ user })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/v1/users/:id
 * Public profile (read-only). Returns sanitized user data.
 */
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const user = await getUserById(req.params.id)
    if (!user) return res.status(404).json({ error: 'User not found' })

    // Only return full data to the user themselves; otherwise public view
    const isSelf = req.auth?.userId && user.clerkId === req.auth.userId
    const data = {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      eloRating: user.eloRating,
      createdAt: user.createdAt,
      ...(isSelf && { email: user.email, preferences: user.preferences, oauthProvider: user.oauthProvider }),
    }

    res.json({ user: data })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/v1/users/:id
 * Update display name, avatar, or preferences. Auth required — own account only.
 */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const user = await getUserById(req.params.id)
    if (!user) return res.status(404).json({ error: 'User not found' })

    // Only allow user to edit their own profile
    if (user.clerkId !== req.auth.userId) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const { displayName, avatarUrl, preferences } = req.body

    if (displayName !== undefined && (typeof displayName !== 'string' || displayName.trim().length === 0)) {
      return res.status(400).json({ error: 'displayName must be a non-empty string' })
    }

    const updated = await updateUser(user.id, { displayName, avatarUrl, preferences })
    res.json({ user: updated })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/v1/users/:id/stats
 */
router.get('/:id/stats', async (req, res, next) => {
  try {
    const user = await getUserById(req.params.id)
    if (!user) return res.status(404).json({ error: 'User not found' })

    const stats = await getUserStats(user.id)
    res.json({ stats })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/v1/users/:id/elo-history
 * Returns the last 50 ELO changes for a user.
 */
router.get('/:id/elo-history', async (req, res, next) => {
  try {
    const user = await getUserById(req.params.id)
    if (!user) return res.status(404).json({ error: 'User not found' })

    const history = await db.userEloHistory.findMany({
      where: { userId: user.id },
      orderBy: { recordedAt: 'desc' },
      take: 50,
    })
    res.json({ eloHistory: history, currentElo: user.eloRating })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/v1/users/:id/games
 * Returns paginated game history for a user.
 */
router.get('/:id/games', async (req, res, next) => {
  try {
    const user = await getUserById(req.params.id)
    if (!user) return res.status(404).json({ error: 'User not found' })

    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(50, parseInt(req.query.limit) || 20)
    const skip = (page - 1) * limit

    const [games, total] = await Promise.all([
      db.game.findMany({
        where: { OR: [{ player1Id: user.id }, { player2Id: user.id }] },
        orderBy: { endedAt: 'desc' },
        skip,
        take: limit,
        include: {
          player1: { select: { id: true, displayName: true, avatarUrl: true } },
          player2: { select: { id: true, displayName: true, avatarUrl: true } },
          winner: { select: { id: true, displayName: true } },
        },
      }),
      db.game.count({
        where: { OR: [{ player1Id: user.id }, { player2Id: user.id }] },
      }),
    ])

    res.json({ games, total, page, limit })
  } catch (err) {
    next(err)
  }
})

export default router
