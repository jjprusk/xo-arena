import { Router } from 'express'
import { Resend } from 'resend'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import db from '../lib/db.js'
import logger from '../logger.js'
import { deleteModel, getSystemConfig, setSystemConfig } from '../services/mlService.js'
import { hasRole } from '../utils/roles.js'
import {
  listFeedback,
  getUnreadCount,
  markRead,
  updateStatus,
  toggleArchive,
  archiveMany,
  deleteFeedback,
  createReply,
} from '../lib/feedbackHelpers.js'
import { replyTemplate } from '../lib/emailTemplates.js'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FROM   = process.env.EMAIL_FROM ?? 'noreply@aiarena.callidity.com'

const router = Router()
router.use(requireAuth, requireAdmin)

// ─── Platform stats ───────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/stats
 * Platform-wide metrics.
 */
router.get('/stats', async (_req, res, next) => {
  try {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [totalUsers, totalGames, gamesToday, bannedUsers, totalModels] = await Promise.all([
      db.user.count({ where: { isBot: false } }),
      db.game.count(),
      db.game.count({ where: { endedAt: { gte: todayStart } } }),
      db.user.count({ where: { banned: true } }),
      db.mLModel.count(),
    ])

    res.json({ stats: { totalUsers, totalGames, gamesToday, bannedUsers, totalModels } })
  } catch (err) {
    next(err)
  }
})

// ─── User management ─────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/users?search=&page=&limit=
 */
router.get('/users', async (req, res, next) => {
  try {
    const search = req.query.search?.trim() || ''
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(100, parseInt(req.query.limit) || 25)
    const skip = (page - 1) * limit

    const where = {
      isBot: false,
      ...(search
        ? {
            OR: [
              { displayName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { username: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    const [rawUsers, total] = await Promise.all([
      db.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          betterAuthId: true,
          username: true,
          displayName: true,
          email: true,
          avatarUrl: true,
          eloRating: true,
          banned: true,
          userRoles: { select: { role: true, grantedAt: true } },
          createdAt: true,
          _count: { select: { gamesAsPlayer1: true } },
        },
      }),
      db.user.count({ where }),
    ])

    // Fetch BA roles + emailVerified + active sessions for all users in one query
    const baIds = rawUsers.map(u => u.betterAuthId).filter(Boolean)
    const now = new Date()
    const [baUsers, baSessions] = baIds.length
      ? await Promise.all([
          db.baUser.findMany({ where: { id: { in: baIds } }, select: { id: true, role: true, emailVerified: true } }),
          db.baSession.findMany({
            where: { userId: { in: baIds }, expiresAt: { gt: now } },
            select: { userId: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
          }),
        ])
      : [[], []]
    const baRoleMap     = Object.fromEntries(baUsers.map(b => [b.id, b.role]))
    const baVerifiedMap = Object.fromEntries(baUsers.map(b => [b.id, b.emailVerified]))
    // Most-recent active session per user
    const baSessionMap  = {}
    for (const s of baSessions) {
      if (!baSessionMap[s.userId]) baSessionMap[s.userId] = s.createdAt
    }

    const users = rawUsers.map(u => ({
      ...u,
      roles: u.userRoles?.map(r => r.role) ?? [],
      baRole: baRoleMap[u.betterAuthId] ?? null,
      emailVerified: baVerifiedMap[u.betterAuthId] ?? null,
      online: Boolean(baSessionMap[u.betterAuthId]),
      signedInAt: baSessionMap[u.betterAuthId] ?? null,
    }))

    res.json({ users, total, page, limit })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/v1/admin/users/:id
 * Update banned status or ELO rating.
 */
router.patch('/users/:id', async (req, res, next) => {
  try {
    const { banned, eloRating, roles, baRole, emailVerified } = req.body

    const data = {}
    if (banned !== undefined) data.banned = Boolean(banned)
    if (eloRating !== undefined) {
      const elo = parseFloat(eloRating)
      if (isNaN(elo) || elo < 0 || elo > 5000) {
        return res.status(400).json({ error: 'eloRating must be between 0 and 5000' })
      }
      data.eloRating = elo
    }
    // Update domain user scalar fields
    let user = null
    const USER_SELECT = {
      id: true, betterAuthId: true, username: true, displayName: true,
      email: true, avatarUrl: true, eloRating: true, banned: true,
      createdAt: true, botLimit: true,
      userRoles: { select: { role: true, grantedAt: true } },
      _count: { select: { gamesAsPlayer1: true } },
    }

    function flattenRoles(rawUser) {
      return { ...rawUser, roles: rawUser.userRoles?.map(r => r.role) ?? [] }
    }

    if (Object.keys(data).length > 0) {
      user = await db.user.update({ where: { id: req.params.id }, data, select: USER_SELECT })
    } else {
      user = await db.user.findUnique({ where: { id: req.params.id }, select: USER_SELECT })
      if (!user) return res.status(404).json({ error: 'User not found' })
    }

    // Update domain roles via UserRole join table
    if (roles !== undefined) {
      const VALID_DOMAIN_ROLES = ['BOT_ADMIN', 'TOURNAMENT_ADMIN']
      const desired = Array.isArray(roles) ? roles.filter(r => VALID_DOMAIN_ROLES.includes(r)) : []
      const current = user.userRoles.map(r => r.role)
      const toAdd    = desired.filter(r => !current.includes(r))
      const toRemove = current.filter(r => !desired.includes(r) && VALID_DOMAIN_ROLES.includes(r))

      // Look up the admin's domain user ID for accurate audit trail
      const adminDomain = await db.user.findUnique({
        where: { betterAuthId: req.auth.userId },
        select: { id: true },
      })
      const grantedById = adminDomain?.id ?? req.params.id

      await Promise.all([
        ...toAdd.map(role =>
          db.userRole.create({ data: { userId: req.params.id, role, grantedById } })
        ),
        ...toRemove.map(role =>
          db.userRole.deleteMany({ where: { userId: req.params.id, role } })
        ),
      ])

      // Re-fetch to return updated roles
      user = await db.user.findUnique({ where: { id: req.params.id }, select: USER_SELECT })
    }

    // Update BA fields (role, emailVerified) if requested
    let baRole_ = null
    let emailVerified_ = null
    if (user.betterAuthId) {
      const baData = {}
      if (baRole !== undefined) {
        const VALID_BA_ROLES = ['admin', null]
        if (!VALID_BA_ROLES.includes(baRole)) {
          return res.status(400).json({ error: 'baRole must be "admin" or null' })
        }
        baData.role = baRole
      }
      if (emailVerified !== undefined) {
        baData.emailVerified = Boolean(emailVerified)
      }

      if (Object.keys(baData).length > 0) {
        const updated = await db.baUser.update({
          where: { id: user.betterAuthId },
          data: baData,
          select: { role: true, emailVerified: true },
        })
        baRole_ = updated.role
        emailVerified_ = updated.emailVerified
      } else {
        const ba = await db.baUser.findUnique({ where: { id: user.betterAuthId }, select: { role: true, emailVerified: true } })
        baRole_ = ba?.role ?? null
        emailVerified_ = ba?.emailVerified ?? null
      }
    }

    res.json({ user: { ...flattenRoles(user), baRole: baRole_, emailVerified: emailVerified_ } })
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' })
    next(err)
  }
})

/**
 * DELETE /api/v1/admin/users/:id
 * Hard-delete a user and all associated data (cascade).
 */
router.delete('/users/:id', async (req, res, next) => {
  try {
    const [domainUser, bots] = await Promise.all([
      db.user.findUnique({ where: { id: req.params.id }, select: { betterAuthId: true } }),
      db.user.findMany({ where: { botOwnerId: req.params.id, isBot: true }, select: { id: true } }),
    ])
    const botIds = bots.map(b => b.id)

    await db.$transaction(async (tx) => {
      for (const botId of botIds) {
        await tx.game.updateMany({ where: { player2Id: botId }, data: { player2Id: null } })
        await tx.game.updateMany({ where: { winnerId:  botId }, data: { winnerId:  null } })
        await tx.game.deleteMany({ where: { player1Id: botId } })
        await tx.user.delete({ where: { id: botId } })
      }
      await tx.game.updateMany({ where: { player2Id: req.params.id }, data: { player2Id: null } })
      await tx.game.updateMany({ where: { winnerId:  req.params.id }, data: { winnerId:  null } })
      await tx.game.deleteMany({ where: { player1Id: req.params.id } })
      await tx.user.delete({ where: { id: req.params.id } })
      // Remove Better Auth records so the email can be re-registered
      if (domainUser?.betterAuthId) {
        await tx.baSession.deleteMany({ where: { userId: domainUser.betterAuthId } })
        await tx.baAccount.deleteMany({ where: { userId: domainUser.betterAuthId } })
        try { await tx.baUser.delete({ where: { id: domainUser.betterAuthId } }) } catch { }
      }
    })

    res.status(204).end()
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' })
    next(err)
  }
})

// ─── Game log ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/games?page=&limit=&mode=&outcome=
 */
router.get('/games', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(100, parseInt(req.query.limit) || 25)
    const skip = (page - 1) * limit

    const where = {}
    if (req.query.mode) where.mode = req.query.mode.toUpperCase()
    if (req.query.outcome) where.outcome = req.query.outcome.toUpperCase()
    if (req.query.player) {
      where.OR = [
        { player1: { displayName: { contains: req.query.player, mode: 'insensitive' } } },
        { player2: { displayName: { contains: req.query.player, mode: 'insensitive' } } },
      ]
    }
    if (req.query.dateFrom || req.query.dateTo) {
      where.endedAt = {}
      if (req.query.dateFrom) where.endedAt.gte = new Date(req.query.dateFrom)
      if (req.query.dateTo) {
        const to = new Date(req.query.dateTo)
        to.setDate(to.getDate() + 1)
        where.endedAt.lt = to
      }
    }

    const [games, total] = await Promise.all([
      db.game.findMany({
        where,
        orderBy: { endedAt: 'desc' },
        skip,
        take: limit,
        include: {
          player1: { select: { id: true, displayName: true, avatarUrl: true } },
          player2: { select: { id: true, displayName: true, avatarUrl: true } },
          winner: { select: { id: true, displayName: true } },
        },
      }),
      db.game.count({ where }),
    ])

    res.json({ games, total, page, limit })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/v1/admin/games/:id
 */
router.delete('/games/:id', async (req, res, next) => {
  try {
    await db.game.delete({ where: { id: req.params.id } })
    res.status(204).end()
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Game not found' })
    next(err)
  }
})

// ─── ML governance ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/ml/models?search=&status=&page=&limit=
 * All models with owner display names, newest first.
 */
router.get('/ml/models', async (req, res, next) => {
  try {
    const VALID_STATUSES = ['IDLE', 'TRAINING']
    const search = req.query.search?.trim() || ''
    const status = VALID_STATUSES.includes(req.query.status) ? req.query.status : ''
    const page   = Math.max(1, parseInt(req.query.page)  || 1)
    const limit  = Math.min(100, parseInt(req.query.limit) || 25)

    const where = {
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      ...(status ? { status } : {}),
    }

    const [models, total] = await Promise.all([
      db.mLModel.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { sessions: true } } },
      }),
      db.mLModel.count({ where }),
    ])

    // Enrich with creator display names.
    // createdBy may store a BA user ID (ba_xxx) for new bots or a domain user ID
    // for bots created before the ownerBaId fix — query both ways.
    const creatorIds = [...new Set(models.map(m => m.createdBy).filter(Boolean))]
    const [byBaId, byDomainId] = creatorIds.length
      ? await Promise.all([
          db.user.findMany({
            where: { betterAuthId: { in: creatorIds } },
            select: { betterAuthId: true, id: true, displayName: true, username: true },
          }),
          db.user.findMany({
            where: { id: { in: creatorIds } },
            select: { betterAuthId: true, id: true, displayName: true, username: true },
          }),
        ])
      : [[], []]
    const creatorMap = Object.fromEntries([
      ...byDomainId.map(u => [u.id, u]),
      ...byBaId.map(u => [u.betterAuthId, u]),
    ])

    const enriched = models.map(m => ({
      ...m,
      creatorName: m.createdBy
        ? (creatorMap[m.createdBy]?.displayName || creatorMap[m.createdBy]?.username || null)
        : null,
    }))

    res.json({ models: enriched, total, page, limit })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/v1/admin/ml/models/:id/feature
 * Toggle featured status on a model.
 */
router.patch('/ml/models/:id/feature', async (req, res, next) => {
  try {
    const model = await db.mLModel.findUnique({ where: { id: req.params.id }, select: { featured: true } })
    if (!model) return res.status(404).json({ error: 'Model not found' })
    const updated = await db.mLModel.update({
      where: { id: req.params.id },
      data: { featured: !model.featured },
    })
    res.json({ model: { id: updated.id, featured: updated.featured } })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/v1/admin/ml/models/:id
 * Hard-delete any model regardless of state.
 * B-26a: blocked if a bot references this model.
 */
router.delete('/ml/models/:id', async (req, res, next) => {
  try {
    // Check for bot reference before deleting
    const referencingBot = await db.user.findFirst({
      where: { botModelId: req.params.id, isBot: true },
      select: { id: true, displayName: true },
    })
    if (referencingBot) {
      return res.status(409).json({
        error: `Cannot delete: bot "${referencingBot.displayName}" references this model. Delete the bot first.`,
        code: 'BOT_REFERENCES_MODEL',
      })
    }

    await deleteModel(req.params.id)
    res.status(204).end()
  } catch (err) {
    if (err.message === 'Model not found' || err.code === 'P2025') {
      return res.status(404).json({ error: 'Model not found' })
    }
    next(err)
  }
})

/**
 * GET /api/v1/admin/ml/limits
 */
router.get('/ml/limits', async (_req, res, next) => {
  try {
    const [maxEpisodes, maxConcurrent, maxModels, maxEpisodesPerModel,
      dqnDefaultHiddenLayers, dqnMaxHiddenLayers, dqnMaxUnitsPerLayer] = await Promise.all([
      getSystemConfig('ml.maxEpisodesPerSession', 100_000),
      getSystemConfig('ml.maxConcurrentSessions', 0),
      getSystemConfig('ml.maxModelsPerUser', 10),
      getSystemConfig('ml.maxEpisodesPerModel', 100_000),
      getSystemConfig('ml.dqn.defaultHiddenLayers', [32]),
      getSystemConfig('ml.dqn.maxHiddenLayers', 3),
      getSystemConfig('ml.dqn.maxUnitsPerLayer', 256),
    ])
    res.json({ limits: {
      maxEpisodesPerSession: maxEpisodes,
      maxConcurrentSessions: maxConcurrent,
      maxModelsPerUser: maxModels,
      maxEpisodesPerModel,
      dqnDefaultHiddenLayers,
      dqnMaxHiddenLayers,
      dqnMaxUnitsPerLayer,
    }})
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/v1/admin/ml/limits
 */
router.patch('/ml/limits', async (req, res, next) => {
  try {
    const { maxEpisodesPerSession, maxConcurrentSessions, maxModelsPerUser, maxEpisodesPerModel,
      dqnDefaultHiddenLayers, dqnMaxHiddenLayers, dqnMaxUnitsPerLayer } = req.body
    const updates = []

    if (maxEpisodesPerSession !== undefined) {
      const v = parseInt(maxEpisodesPerSession)
      if (isNaN(v) || v < 0) return res.status(400).json({ error: 'maxEpisodesPerSession must be a non-negative integer' })
      updates.push(setSystemConfig('ml.maxEpisodesPerSession', v))
    }
    if (maxConcurrentSessions !== undefined) {
      const v = parseInt(maxConcurrentSessions)
      if (isNaN(v) || v < 0) return res.status(400).json({ error: 'maxConcurrentSessions must be a non-negative integer' })
      updates.push(setSystemConfig('ml.maxConcurrentSessions', v))
    }
    if (maxModelsPerUser !== undefined) {
      const v = parseInt(maxModelsPerUser)
      if (isNaN(v) || v < 0) return res.status(400).json({ error: 'maxModelsPerUser must be a non-negative integer' })
      updates.push(setSystemConfig('ml.maxModelsPerUser', v))
    }
    if (maxEpisodesPerModel !== undefined) {
      const v = parseInt(maxEpisodesPerModel)
      if (isNaN(v) || v < 0) return res.status(400).json({ error: 'maxEpisodesPerModel must be a non-negative integer' })
      updates.push(setSystemConfig('ml.maxEpisodesPerModel', v))
    }
    if (dqnDefaultHiddenLayers !== undefined) {
      if (!Array.isArray(dqnDefaultHiddenLayers) || dqnDefaultHiddenLayers.length === 0) {
        return res.status(400).json({ error: 'dqnDefaultHiddenLayers must be a non-empty array' })
      }
      for (const u of dqnDefaultHiddenLayers) {
        if (!Number.isInteger(u) || u < 1) return res.status(400).json({ error: 'Each layer size must be a positive integer' })
      }
      updates.push(setSystemConfig('ml.dqn.defaultHiddenLayers', dqnDefaultHiddenLayers))
    }
    if (dqnMaxHiddenLayers !== undefined) {
      const v = parseInt(dqnMaxHiddenLayers)
      if (isNaN(v) || v < 1) return res.status(400).json({ error: 'dqnMaxHiddenLayers must be a positive integer' })
      updates.push(setSystemConfig('ml.dqn.maxHiddenLayers', v))
    }
    if (dqnMaxUnitsPerLayer !== undefined) {
      const v = parseInt(dqnMaxUnitsPerLayer)
      if (isNaN(v) || v < 1) return res.status(400).json({ error: 'dqnMaxUnitsPerLayer must be a positive integer' })
      updates.push(setSystemConfig('ml.dqn.maxUnitsPerLayer', v))
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' })
    await Promise.all(updates)

    const [updatedMaxEpisodes, updatedMaxConcurrent, updatedMaxModels, updatedMaxEpisodesPerModel,
      updatedDqnDefaultHiddenLayers, updatedDqnMaxHiddenLayers, updatedDqnMaxUnitsPerLayer] = await Promise.all([
      getSystemConfig('ml.maxEpisodesPerSession', 100_000),
      getSystemConfig('ml.maxConcurrentSessions', 0),
      getSystemConfig('ml.maxModelsPerUser', 10),
      getSystemConfig('ml.maxEpisodesPerModel', 100_000),
      getSystemConfig('ml.dqn.defaultHiddenLayers', [32]),
      getSystemConfig('ml.dqn.maxHiddenLayers', 3),
      getSystemConfig('ml.dqn.maxUnitsPerLayer', 256),
    ])
    res.json({ limits: {
      maxEpisodesPerSession: updatedMaxEpisodes,
      maxConcurrentSessions: updatedMaxConcurrent,
      maxModelsPerUser: updatedMaxModels,
      maxEpisodesPerModel: updatedMaxEpisodesPerModel,
      dqnDefaultHiddenLayers: updatedDqnDefaultHiddenLayers,
      dqnMaxHiddenLayers: updatedDqnMaxHiddenLayers,
      dqnMaxUnitsPerLayer: updatedDqnMaxUnitsPerLayer,
    }})
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/v1/admin/ml/models/:id/max-episodes
 * Override per-model episode cap. Can only increase, not decrease.
 */
router.patch('/ml/models/:id/max-episodes', async (req, res, next) => {
  try {
    const model = await db.mLModel.findUnique({ where: { id: req.params.id }, select: { id: true, maxEpisodes: true } })
    if (!model) return res.status(404).json({ error: 'Model not found' })

    const v = parseInt(req.body.maxEpisodes)
    if (isNaN(v) || v < 0) return res.status(400).json({ error: 'maxEpisodes must be a non-negative integer (0 = unlimited)' })
    if (v > 0 && v < model.maxEpisodes) {
      return res.status(400).json({ error: `Cannot decrease maxEpisodes (current: ${model.maxEpisodes.toLocaleString()})` })
    }

    const updated = await db.mLModel.update({ where: { id: req.params.id }, data: { maxEpisodes: v } })
    res.json({ model: { id: updated.id, maxEpisodes: updated.maxEpisodes } })
  } catch (err) {
    next(err)
  }
})

// ─── Log retention ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/logs/limit
 */
router.get('/logs/limit', async (_req, res, next) => {
  try {
    const maxEntries = await getSystemConfig('logs.maxEntries', 10_000)
    res.json({ maxEntries })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/v1/admin/logs/limit
 */
router.patch('/logs/limit', async (req, res, next) => {
  try {
    const v = parseInt(req.body.maxEntries)
    if (isNaN(v) || v < 0) {
      return res.status(400).json({ error: 'maxEntries must be a non-negative integer' })
    }
    await setSystemConfig('logs.maxEntries', v)
    res.json({ maxEntries: v })
  } catch (err) {
    next(err)
  }
})

// ─── Bot management ───────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/bots?search=&page=&limit=
 * All bots with owner info.
 */
router.get('/bots', async (req, res, next) => {
  try {
    const search = req.query.search?.trim() || ''
    const page  = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(100, parseInt(req.query.limit) || 25)
    const skip  = (page - 1) * limit

    const where = {
      isBot: true,
      ...(search ? { displayName: { contains: search, mode: 'insensitive' } } : {}),
    }

    const [bots, total] = await Promise.all([
      db.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          displayName: true,
          avatarUrl: true,
          eloRating: true,
          botModelType: true,
          botModelId: true,
          botActive: true,
          botAvailable: true,
          botCompetitive: true,
          botProvisional: true,
          botInTournament: true,
          botOwnerId: true,
          createdAt: true,
        },
      }),
      db.user.count({ where }),
    ])

    // Enrich with owner display names
    const ownerIds = [...new Set(bots.map(b => b.botOwnerId).filter(Boolean))]
    const owners = ownerIds.length
      ? await db.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, displayName: true, username: true },
        })
      : []
    const ownerMap = Object.fromEntries(owners.map(o => [o.id, o]))

    const enriched = bots.map(b => ({
      ...b,
      owner: b.botOwnerId ? (ownerMap[b.botOwnerId] ?? null) : null,
    }))

    res.json({ bots: enriched, total, page, limit })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/v1/admin/bots/:id
 * Toggle botActive or rename.
 */
router.patch('/bots/:id', async (req, res, next) => {
  try {
    const bot = await db.user.findUnique({ where: { id: req.params.id }, select: { id: true, isBot: true } })
    if (!bot || !bot.isBot) return res.status(404).json({ error: 'Bot not found' })

    const { botActive, botAvailable, displayName } = req.body
    const data = {}
    if (botActive !== undefined) data.botActive = Boolean(botActive)
    if (botAvailable !== undefined) data.botAvailable = Boolean(botAvailable)
    if (displayName !== undefined) {
      const trimmed = displayName.trim()
      if (!trimmed) return res.status(400).json({ error: 'Name cannot be empty' })
      const RESERVED = ['rusty', 'copper', 'sterling', 'magnus']
      if (RESERVED.includes(trimmed.toLowerCase())) {
        return res.status(400).json({ error: `"${trimmed}" is a reserved name`, code: 'RESERVED_NAME' })
      }
      const profanityList = await getSystemConfig('bots.profanityList', [])
      if (Array.isArray(profanityList) && profanityList.length > 0) {
        const lower = trimmed.toLowerCase()
        for (const word of profanityList) {
          if (lower.includes(word.toLowerCase())) {
            return res.status(400).json({ error: 'Bot name contains disallowed content', code: 'PROFANITY' })
          }
        }
      }
      data.displayName = trimmed
    }

    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nothing to update' })
    const updated = await db.user.update({ where: { id: req.params.id }, data })
    res.json({ bot: updated })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/v1/admin/bots/:id
 * Hard delete any bot.
 */
router.delete('/bots/:id', async (req, res, next) => {
  try {
    const bot = await db.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, isBot: true, botModelId: true },
    })
    if (!bot || !bot.isBot) return res.status(404).json({ error: 'Bot not found' })

    await db.$transaction(async (tx) => {
      await tx.game.deleteMany({ where: { player1Id: bot.id } })
      await tx.user.delete({ where: { id: bot.id } })
    })

    if (bot.botModelId) {
      await db.mLModel.delete({ where: { id: bot.botModelId } }).catch(() => {})
    }

    res.status(204).end()
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Bot not found' })
    next(err)
  }
})

/**
 * GET /api/v1/admin/bot-limits
 */
router.get('/bot-limits', async (_req, res, next) => {
  try {
    const defaultBotLimit = await getSystemConfig('bots.defaultBotLimit', 5)
    res.json({ defaultBotLimit })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/v1/admin/bot-limits
 */
router.patch('/bot-limits', async (req, res, next) => {
  try {
    const { defaultBotLimit } = req.body
    if (defaultBotLimit !== undefined) {
      const v = parseInt(defaultBotLimit)
      if (isNaN(v) || v < 0) return res.status(400).json({ error: 'defaultBotLimit must be a non-negative integer' })
      await setSystemConfig('bots.defaultBotLimit', v)
    }
    const updated = await getSystemConfig('bots.defaultBotLimit', 5)
    res.json({ defaultBotLimit: updated })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/v1/admin/aivai-config
 */
router.get('/aivai-config', async (_req, res, next) => {
  try {
    const maxGames = await getSystemConfig('aivai.maxGames', 5)
    res.json({ maxGames })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/v1/admin/aivai-config
 */
router.patch('/aivai-config', async (req, res, next) => {
  try {
    const { maxGames } = req.body
    if (maxGames !== undefined) {
      const v = parseInt(maxGames)
      if (isNaN(v) || v < 1) return res.status(400).json({ error: 'maxGames must be a positive integer' })
      await setSystemConfig('aivai.maxGames', v)
    }
    const updated = await getSystemConfig('aivai.maxGames', 5)
    res.json({ maxGames: updated })
  } catch (err) {
    next(err)
  }
})

// ─── Feedback management (admin mirror) ──────────────────────────────────────

/**
 * GET /api/v1/admin/feedback
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
 * GET /api/v1/admin/feedback/unread-count
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
 * PATCH /api/v1/admin/feedback/archive-many
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
 * PATCH /api/v1/admin/feedback/:id/read
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
 * PATCH /api/v1/admin/feedback/:id/status
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
 * PATCH /api/v1/admin/feedback/:id/archive
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
 * DELETE /api/v1/admin/feedback/:id
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

/**
 * POST /api/v1/admin/feedback/:id/reply
 * Body: { message }
 */
router.post('/feedback/:id/reply', async (req, res, next) => {
  try {
    const { message } = req.body
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' })

    const domainUser = await db.user.findUnique({
      where:  { betterAuthId: req.auth.userId },
      select: { id: true, displayName: true },
    })
    if (!domainUser) return res.status(403).json({ error: 'Forbidden' })

    const result = await createReply(req.params.id, domainUser.id, message.trim())
    if (!result) return res.status(404).json({ error: 'Feedback not found' })

    // Non-fatal reply email to submitter (verified email only)
    if (resend && result.feedback.user?.email && result.feedback.user?.betterAuthId) {
      const baUser = await db.baUser.findUnique({
        where:  { id: result.feedback.user.betterAuthId },
        select: { emailVerified: true },
      }).catch(() => null)

      if (baUser?.emailVerified) {
        resend.emails.send({
          from:    FROM,
          to:      result.feedback.user.email,
          subject: 'A reply to your XO Arena feedback',
          html:    replyTemplate({
            name:            result.feedback.user.displayName ?? 'there',
            adminName:       domainUser.displayName ?? 'Staff',
            originalMessage: result.feedback.message,
            replyMessage:    message.trim(),
          }),
        }).catch(err => logger.warn({ err: err.message }, 'Reply email failed (non-fatal)'))
      }
    }

    res.status(201).json({ reply: result.reply, replies: result.replies })
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Feedback not found' })
    next(err)
  }
})

export default router
