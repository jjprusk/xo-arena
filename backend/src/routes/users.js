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
 * GET /api/v1/me/roles
 * Returns the domain roles for the authenticated user.
 */
router.get('/me/roles', requireAuth, async (req, res, next) => {
  try {
    const user = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      select: { userRoles: { select: { role: true } } },
    })
    const roles = user?.userRoles?.map(r => r.role) ?? []
    res.json({ roles })
  } catch (err) {
    next(err)
  }
})

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

    const rawName = baUser.name?.trim()
    const resolvedName = (rawName && rawName.toLowerCase() !== 'unknown')
      ? rawName
      : baUser.email.split('@')[0]
    const user = await syncUser({
      betterAuthId: baUser.id,
      email: baUser.email,
      username: resolvedName.toLowerCase().replace(/\s+/g, '_'),
      displayName: resolvedName,
      oauthProvider: 'email',
      avatarUrl: baUser.image || null,
    })

    // If nameConfirmed is still false, check whether this is a credential (email)
    // account — ba_accounts is guaranteed to exist by the time /sync is called.
    // Email users get confirmed automatically; OAuth users stay false and get prompted.
    let nameConfirmed = user.nameConfirmed
    if (!nameConfirmed) {
      const credentialAccount = await db.baAccount.findFirst({
        where: { userId: baUser.id, providerId: 'credential' },
      })
      if (credentialAccount) {
        await db.user.update({ where: { id: user.id }, data: { nameConfirmed: true } })
        nameConfirmed = true
      }
    }

    res.json({ user: { ...user, baRole: baUser.role ?? null, nameConfirmed } })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/v1/users/me
 * Permanently deletes the authenticated user's account.
 * Blocked for admin accounts.
 */
router.delete('/me', requireAuth, async (req, res, next) => {
  try {
    const baUser = await db.baUser.findUnique({ where: { id: req.auth.userId } })
    if (!baUser) return res.status(404).json({ error: 'User not found' })

    if (baUser.role === 'admin') {
      return res.status(403).json({ error: 'Admin accounts cannot be self-deleted.' })
    }

    const domainUser = await db.user.findUnique({ where: { betterAuthId: baUser.id } })
    if (!domainUser) {
      // No domain record — just delete the auth record
      await db.baUser.delete({ where: { id: baUser.id } })
      return res.json({ ok: true })
    }

    // Collect bot IDs before the transaction so we can clean up their games
    const bots = await db.user.findMany({
      where: { botOwnerId: domainUser.id, isBot: true },
      select: { id: true },
    })
    const botIds = bots.map(b => b.id)

    await db.$transaction(async (tx) => {
      // Delete each bot's games, then the bot itself
      for (const botId of botIds) {
        await tx.game.updateMany({ where: { player2Id: botId }, data: { player2Id: null } })
        await tx.game.updateMany({ where: { winnerId:  botId }, data: { winnerId:  null } })
        await tx.game.deleteMany({ where: { player1Id: botId } })
        await tx.user.delete({ where: { id: botId } })
      }

      // Nullify nullable game references for the owner
      await tx.game.updateMany({ where: { player2Id: domainUser.id }, data: { player2Id: null } })
      await tx.game.updateMany({ where: { winnerId:  domainUser.id }, data: { winnerId:  null } })

      // Delete games where user is player1 (NOT NULL — cannot nullify)
      await tx.game.deleteMany({ where: { player1Id: domainUser.id } })

      // Delete the domain User (cascades UserEloHistory, UserRole)
      await tx.user.delete({ where: { id: domainUser.id } })

      // Delete the Better Auth user (cascades BaSession, BaAccount)
      await tx.baUser.delete({ where: { id: baUser.id } })
    })

    logger.info({ userId: domainUser.id }, 'User self-deleted account')
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/v1/users/me/hints
 * Returns per-user hint flags so the client knows what to show.
 */
router.get('/me/hints', requireAuth, async (req, res, next) => {
  try {
    const user = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      select: { preferences: true },
    })
    const prefs = (user?.preferences && typeof user.preferences === 'object') ? user.preferences : {}
    res.json({ faqHintSeen: !!prefs.faqHintSeen })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/v1/users/me/hints/faq
 * Marks the FAQ hint as seen — stored inside the user's preferences JSON.
 */
router.post('/me/hints/faq', requireAuth, async (req, res, next) => {
  try {
    const user = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      select: { id: true, preferences: true },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })
    const prefs = (user.preferences && typeof user.preferences === 'object') ? user.preferences : {}
    await db.user.update({ where: { id: user.id }, data: { preferences: { ...prefs, faqHintSeen: true } } })
    res.json({ ok: true })
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
      ...(isSelf && { email: user.email, preferences: user.preferences, oauthProvider: user.oauthProvider, nameConfirmed: user.nameConfirmed }),
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
