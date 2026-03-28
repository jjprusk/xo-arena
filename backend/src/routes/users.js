import { Router } from 'express'
import { requireAuth, optionalAuth } from '../middleware/auth.js'
import { getUserById, updateUser, getUserStats, getBotStats, syncUser } from '../services/userService.js'
import db from '../lib/db.js'
import logger from '../logger.js'

/**
 * Fetch bot-specific profile fields for a bot User row.
 * Returns null if the user is not a bot.
 */
async function getBotProfileData(user) {
  if (!user.isBot) return null

  const [owner, mlModel] = await Promise.all([
    user.botOwnerId
      ? db.user.findUnique({ where: { id: user.botOwnerId }, select: { id: true, displayName: true, betterAuthId: true } })
      : null,
    user.botModelId && user.botModelId.startsWith('builtin:') === false
      ? db.mLModel.findUnique({
          where: { id: user.botModelId },
          select: { id: true, name: true, algorithm: true, updatedAt: true, totalEpisodes: true },
        }).catch(() => null)
      : null,
  ])

  return {
    isBot: true,
    botModelType: user.botModelType,
    botModelId: user.botModelId,
    botActive: user.botActive,
    botAvailable: user.botAvailable,
    botInTournament: user.botInTournament,
    botCompetitive: user.botCompetitive,
    botProvisional: user.botProvisional,
    botEloResetAt: user.botEloResetAt,
    ownerBetterAuthId: owner?.betterAuthId ?? null,
    owner: owner ? { id: owner.id, displayName: owner.displayName } : null,
    mlModel: mlModel ? { id: mlModel.id, name: mlModel.name, algorithm: mlModel.algorithm, updatedAt: mlModel.updatedAt, totalEpisodes: mlModel.totalEpisodes } : null,
  }
}

const router = Router()

/**
 * POST /api/v1/users/sync
 * Called by the frontend after login to ensure the user exists in our DB.
 * Requires auth.
 */
router.post('/sync', requireAuth, async (req, res, next) => {
  try {
    // req.auth.userId is the BA user ID (ba_users.id)
    const baUser = await db.baUser.findUnique({ where: { id: req.auth.userId } })
    if (!baUser) return res.status(404).json({ error: 'Auth user not found' })

    const user = await syncUser({
      betterAuthId: baUser.id,
      email: baUser.email,
      username: baUser.name?.toLowerCase().replace(/\s+/g, '_') || baUser.email.split('@')[0],
      displayName: baUser.name || baUser.email.split('@')[0],
      oauthProvider: 'email',
      avatarUrl: baUser.image || null,
    })

    res.json({ user: { ...user, baRole: baUser.role ?? null } })
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
    const isSelf = req.auth?.userId && user.betterAuthId === req.auth.userId
    const botData = user.isBot ? await getBotProfileData(user) : null

    const data = {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      eloRating: user.eloRating,
      createdAt: user.createdAt,
      ...(botData ?? {}),
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
    if (user.betterAuthId !== req.auth.userId) {
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
    const [user, stats] = await Promise.all([
      getUserById(req.params.id),
      getUserStats(req.params.id),
    ])
    if (!user) return res.status(404).json({ error: 'User not found' })

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
    const [user, history] = await Promise.all([
      getUserById(req.params.id),
      db.userEloHistory.findMany({
        where: { userId: req.params.id },
        orderBy: { recordedAt: 'desc' },
        take: 50,
      }),
    ])
    if (!user) return res.status(404).json({ error: 'User not found' })

    res.json({ eloHistory: history, currentElo: user.eloRating })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/v1/users/:id/ml-profiles
 * Returns all ML player profiles for the authenticated user.
 * Requires auth — users can only fetch their own profiles.
 */
router.get('/:id/ml-profiles', requireAuth, async (req, res, next) => {
  try {
    const [user, profiles] = await Promise.all([
      getUserById(req.params.id),
      // Use req.auth.userId (BA ID from JWT) directly — this is what gets
      // stored in MLPlayerProfile.userId when the frontend records moves.
      db.mLPlayerProfile.findMany({
        where: { userId: req.auth.userId },
        orderBy: { gamesRecorded: 'desc' },
        include: {
          model: { select: { id: true, name: true, algorithm: true } },
        },
      }),
    ])
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.betterAuthId !== req.auth.userId) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    res.json({ profiles })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/v1/users/:id/bot-stats
 * Returns win-rate breakdown for a bot (vs humans / vs bots).
 * Public endpoint — no auth required.
 */
router.get('/:id/bot-stats', async (req, res, next) => {
  try {
    const [user, stats] = await Promise.all([
      getUserById(req.params.id),
      getBotStats(req.params.id),
    ])
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (!user.isBot) return res.status(400).json({ error: 'Not a bot' })

    res.json({ stats })
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
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(50, parseInt(req.query.limit) || 20)
    const skip = (page - 1) * limit
    const userId = req.params.id

    const [user, games, total] = await Promise.all([
      getUserById(userId),
      db.game.findMany({
        where: { OR: [{ player1Id: userId }, { player2Id: userId }] },
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
        where: { OR: [{ player1Id: userId }, { player2Id: userId }] },
      }),
    ])
    if (!user) return res.status(404).json({ error: 'User not found' })

    res.json({ games, total, page, limit })
  } catch (err) {
    next(err)
  }
})

export default router
