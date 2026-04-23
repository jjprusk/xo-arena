// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { Router } from 'express'
import { Resend } from 'resend'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import db from '../lib/db.js'
import logger from '../logger.js'
import { getSnapshots, getLatestSnapshot, getAlerts } from '../lib/resourceCounters.js'
import { deleteModel, getSystemConfig, setSystemConfig } from '../services/skillService.js'
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
import { dispatch, emitToRoom } from '../lib/notificationBus.js'
import { sweep as gcSweep } from '../services/tableGcService.js'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FROM   = process.env.EMAIL_FROM ?? 'noreply@aiarena.callidity.com'

const router = Router()

// ─── GC trigger (manual QA / on-demand sweep) ────────────────────────────────
// Placed before requireAuth so it can accept either a valid admin JWT or the
// QA_SECRET env var (read by qa-scripts/*.sh — no browser token needed).

router.post('/gc/run', async (req, res, next) => {
  try {
    const qaSecret = process.env.QA_SECRET
    const headerSecret = req.headers['x-qa-secret']
    if (!qaSecret || headerSecret !== qaSecret) {
      // Fall through to normal admin auth — still works with a real JWT too
      return next('route')
    }
    const result = await gcSweep(null)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

router.use(requireAuth, requireAdmin)

// ─── Resource health ─────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/health/sockets
 * Returns current resource counters, rolling snapshot history, and active leak alerts.
 */
router.get('/health/sockets', (req, res) => {
  res.json({
    latest: getLatestSnapshot(),
    history: getSnapshots(),
    alerts: getAlerts(),
    uptime: Math.round(process.uptime()),
  })
})

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
      db.botSkill.count(),
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
    const status = req.query.status || ''
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(100, parseInt(req.query.limit) || 25)
    const skip = (page - 1) * limit

    // For "online" filter, pre-fetch active BA session IDs so we can filter the user query
    const now = new Date()
    let onlineBaIds = null
    if (status === 'online') {
      const activeSessions = await db.baSession.findMany({
        where: { expiresAt: { gt: now } },
        select: { userId: true },
      })
      onlineBaIds = [...new Set(activeSessions.map(s => s.userId))]
    }

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const where = {
      isBot: false,
      ...(search ? {
        OR: [
          { displayName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { username: { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
      ...(status === 'active'   ? { banned: false } : {}),
      ...(status === 'banned'   ? { banned: true  } : {}),
      ...(status === 'online'   ? { betterAuthId: { in: onlineBaIds } } : {}),
      ...(status === 'inactive' ? { OR: [{ lastActiveAt: { lt: sevenDaysAgo } }, { lastActiveAt: null }] } : {}),
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
          banned: true,
          lastActiveAt: true,
          gameElo: { where: { gameId: 'xo' }, select: { rating: true } },
          userRoles: { select: { role: true, grantedAt: true } },
          createdAt: true,
          _count: { select: { gamesAsPlayer1: true } },
        },
      }),
      db.user.count({ where }),
    ])

    // Fetch BA roles + emailVerified + active sessions for all users in one query
    const baIds = rawUsers.map(u => u.betterAuthId).filter(Boolean)
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
      eloRating: u.gameElo?.[0]?.rating ?? 1200,
      gameElo: undefined,
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
    let eloOverride = undefined
    if (eloRating !== undefined) {
      const elo = parseFloat(eloRating)
      if (isNaN(elo) || elo < 0 || elo > 5000) {
        return res.status(400).json({ error: 'eloRating must be between 0 and 5000' })
      }
      eloOverride = elo
    }
    // Update domain user scalar fields
    let user = null
    const USER_SELECT = {
      id: true, betterAuthId: true, username: true, displayName: true,
      email: true, avatarUrl: true, banned: true,
      createdAt: true, botLimit: true,
      gameElo: { where: { gameId: 'xo' }, select: { rating: true } },
      userRoles: { select: { role: true, grantedAt: true } },
      _count: { select: { gamesAsPlayer1: true } },
    }

    function flattenRoles(rawUser) {
      return {
        ...rawUser,
        eloRating: rawUser.gameElo?.[0]?.rating ?? 1200,
        gameElo: undefined,
        roles: rawUser.userRoles?.map(r => r.role) ?? [],
      }
    }

    if (Object.keys(data).length > 0) {
      user = await db.user.update({ where: { id: req.params.id }, data, select: USER_SELECT })
    } else {
      user = await db.user.findUnique({ where: { id: req.params.id }, select: USER_SELECT })
      if (!user) return res.status(404).json({ error: 'User not found' })
    }
    // Update GameElo if eloRating was provided
    if (eloOverride !== undefined) {
      await db.gameElo.upsert({
        where: { userId_gameId: { userId: req.params.id, gameId: 'xo' } },
        update: { rating: eloOverride },
        create: { userId: req.params.id, gameId: 'xo', rating: eloOverride, gamesPlayed: 0 },
      })
      user = await db.user.findUnique({ where: { id: req.params.id }, select: USER_SELECT })
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
/**
 * GET /api/v1/admin/users/:id
 * Single user with full enrichment (baRole, emailVerified, online, signedInAt).
 */
router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await db.user.findUnique({
      where: { id: req.params.id, isBot: false },
      select: {
        id: true, betterAuthId: true, username: true, displayName: true,
        email: true, avatarUrl: true, banned: true,
        oauthProvider: true, createdAt: true, botLimit: true,
        gameElo: { where: { gameId: 'xo' }, select: { rating: true } },
        userRoles: { select: { role: true, grantedAt: true } },
        _count: { select: { gamesAsPlayer1: true } },
      },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })

    const now = new Date()
    const [baUser, sessions] = user.betterAuthId
      ? await Promise.all([
          db.baUser.findUnique({ where: { id: user.betterAuthId }, select: { role: true, emailVerified: true } }),
          db.baSession.findMany({
            where: { userId: user.betterAuthId, expiresAt: { gt: now } },
            select: { createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          }),
        ])
      : [null, []]

    res.json({
      user: {
        ...user,
        eloRating: user.gameElo?.[0]?.rating ?? 1200,
        gameElo: undefined,
        roles: user.userRoles?.map(r => r.role) ?? [],
        baRole: baUser?.role ?? null,
        emailVerified: baUser?.emailVerified ?? null,
        online: sessions.length > 0,
        signedInAt: sessions[0]?.createdAt ?? null,
      },
    })
  } catch (err) {
    next(err)
  }
})

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

    const where = { totalMoves: { gt: 0 } }
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
      db.botSkill.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { sessions: true } } },
      }),
      db.botSkill.count({ where }),
    ])

    // Enrich with creator display names.
    // createdBy may store a BA user ID (ba_xxx) for new bots or a domain user ID
    // for bots created before the ownerBaId fix — query both ways.
    const creatorIds = [...new Set(models.map(m => m.createdBy).filter(Boolean))]
    const botIds = [...new Set(models.map(m => m.botId).filter(Boolean))]

    const [byBaId, byDomainId, botEloRows] = await Promise.all([
      creatorIds.length
        ? db.user.findMany({
            where: { betterAuthId: { in: creatorIds } },
            select: { betterAuthId: true, id: true, displayName: true, username: true },
          })
        : [],
      creatorIds.length
        ? db.user.findMany({
            where: { id: { in: creatorIds } },
            select: { betterAuthId: true, id: true, displayName: true, username: true },
          })
        : [],
      botIds.length
        ? db.gameElo.findMany({
            where: { userId: { in: botIds }, gameId: 'xo' },
            select: { userId: true, rating: true },
          })
        : [],
    ])

    const creatorMap = Object.fromEntries([
      ...byDomainId.map(u => [u.id, u]),
      ...byBaId.map(u => [u.betterAuthId, u]),
    ])
    const eloMap = Object.fromEntries(botEloRows.map(r => [r.userId, r.rating]))

    const enriched = models.map(m => ({
      ...m,
      eloRating: m.botId ? (eloMap[m.botId] ?? 1200) : null,
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
    const model = await db.botSkill.findUnique({ where: { id: req.params.id }, select: { featured: true } })
    if (!model) return res.status(404).json({ error: 'Model not found' })
    const updated = await db.botSkill.update({
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
      dqnDefaultHiddenLayers, dqnMaxHiddenLayers, dqnMaxUnitsPerLayer,
      epsBronze, epsSilver, epsGold, epsPlatinum, epsDiamond] = await Promise.all([
      getSystemConfig('ml.maxEpisodesPerSession', 100_000),
      getSystemConfig('ml.maxConcurrentSessions', 0),
      getSystemConfig('ml.maxModelsPerUser', 10),
      getSystemConfig('ml.maxEpisodesPerModel', 100_000),
      getSystemConfig('ml.dqn.defaultHiddenLayers', [32]),
      getSystemConfig('ml.dqn.maxHiddenLayers', 3),
      getSystemConfig('ml.dqn.maxUnitsPerLayer', 256),
      getSystemConfig('credits.limits.episodesPerSession.bronze',   1_000),
      getSystemConfig('credits.limits.episodesPerSession.silver',   5_000),
      getSystemConfig('credits.limits.episodesPerSession.gold',    20_000),
      getSystemConfig('credits.limits.episodesPerSession.platinum', 50_000),
      getSystemConfig('credits.limits.episodesPerSession.diamond', 100_000),
    ])
    res.json({ limits: {
      maxEpisodesPerSession: maxEpisodes,
      maxConcurrentSessions: maxConcurrent,
      maxModelsPerUser: maxModels,
      maxEpisodesPerModel,
      dqnDefaultHiddenLayers,
      dqnMaxHiddenLayers,
      dqnMaxUnitsPerLayer,
      episodesPerSessionTiers: { bronze: epsBronze, silver: epsSilver, gold: epsGold, platinum: epsPlatinum, diamond: epsDiamond },
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
      dqnDefaultHiddenLayers, dqnMaxHiddenLayers, dqnMaxUnitsPerLayer,
      episodesPerSessionTiers } = req.body
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

    if (episodesPerSessionTiers !== undefined) {
      const TIER_KEYS = { bronze: 1_000, silver: 5_000, gold: 20_000, platinum: 50_000, diamond: 100_000 }
      for (const [tier, def] of Object.entries(TIER_KEYS)) {
        if (episodesPerSessionTiers[tier] !== undefined) {
          const v = parseInt(episodesPerSessionTiers[tier])
          if (isNaN(v) || v < 0) return res.status(400).json({ error: `episodesPerSessionTiers.${tier} must be a non-negative integer` })
          updates.push(setSystemConfig(`credits.limits.episodesPerSession.${tier}`, v))
        }
      }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' })
    await Promise.all(updates)

    const [updatedMaxEpisodes, updatedMaxConcurrent, updatedMaxModels, updatedMaxEpisodesPerModel,
      updatedDqnDefaultHiddenLayers, updatedDqnMaxHiddenLayers, updatedDqnMaxUnitsPerLayer,
      epsBronze, epsSilver, epsGold, epsPlatinum, epsDiamond] = await Promise.all([
      getSystemConfig('ml.maxEpisodesPerSession', 100_000),
      getSystemConfig('ml.maxConcurrentSessions', 0),
      getSystemConfig('ml.maxModelsPerUser', 10),
      getSystemConfig('ml.maxEpisodesPerModel', 100_000),
      getSystemConfig('ml.dqn.defaultHiddenLayers', [32]),
      getSystemConfig('ml.dqn.maxHiddenLayers', 3),
      getSystemConfig('ml.dqn.maxUnitsPerLayer', 256),
      getSystemConfig('credits.limits.episodesPerSession.bronze',    1_000),
      getSystemConfig('credits.limits.episodesPerSession.silver',    5_000),
      getSystemConfig('credits.limits.episodesPerSession.gold',     20_000),
      getSystemConfig('credits.limits.episodesPerSession.platinum',  50_000),
      getSystemConfig('credits.limits.episodesPerSession.diamond', 100_000),
    ])
    res.json({ limits: {
      maxEpisodesPerSession: updatedMaxEpisodes,
      maxConcurrentSessions: updatedMaxConcurrent,
      maxModelsPerUser: updatedMaxModels,
      maxEpisodesPerModel: updatedMaxEpisodesPerModel,
      dqnDefaultHiddenLayers: updatedDqnDefaultHiddenLayers,
      dqnMaxHiddenLayers: updatedDqnMaxHiddenLayers,
      dqnMaxUnitsPerLayer: updatedDqnMaxUnitsPerLayer,
      episodesPerSessionTiers: { bronze: epsBronze, silver: epsSilver, gold: epsGold, platinum: epsPlatinum, diamond: epsDiamond },
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
    const model = await db.botSkill.findUnique({ where: { id: req.params.id }, select: { id: true, maxEpisodes: true } })
    if (!model) return res.status(404).json({ error: 'Model not found' })

    const v = parseInt(req.body.maxEpisodes)
    if (isNaN(v) || v < 0) return res.status(400).json({ error: 'maxEpisodes must be a non-negative integer (0 = unlimited)' })
    if (v > 0 && v < model.maxEpisodes) {
      return res.status(400).json({ error: `Cannot decrease maxEpisodes (current: ${model.maxEpisodes.toLocaleString()})` })
    }

    const updated = await db.botSkill.update({ where: { id: req.params.id }, data: { maxEpisodes: v } })
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
    const systemOnly = req.query.systemOnly === '1' || req.query.systemOnly === 'true'

    const where = {
      isBot: true,
      ...(systemOnly ? { botOwnerId: null } : {}),
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
          gameElo: { where: { gameId: 'xo' }, select: { rating: true } },
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

    // Enrich with per-game skills
    const botIds = bots.map(b => b.id)
    const allSkills = botIds.length
      ? await db.botSkill.findMany({
          where: { botId: { in: botIds } },
          select: { botId: true, gameId: true, algorithm: true, status: true },
        })
      : []
    const skillsByBot = {}
    for (const s of allSkills) {
      if (!skillsByBot[s.botId]) skillsByBot[s.botId] = []
      skillsByBot[s.botId].push({ gameId: s.gameId, algorithm: s.algorithm, status: s.status })
    }

    const enriched = bots.map(b => ({
      ...b,
      eloRating: b.gameElo?.[0]?.rating ?? 1200,
      gameElo: undefined,
      owner: b.botOwnerId ? (ownerMap[b.botOwnerId] ?? null) : null,
      skills: skillsByBot[b.id] ?? [],
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
// Usernames of the four built-in personas — cannot be deleted via admin API.
const BUILTIN_BOT_USERNAMES = new Set(['bot-rusty', 'bot-copper', 'bot-sterling', 'bot-magnus'])

router.delete('/bots/:id', async (req, res, next) => {
  try {
    const bot = await db.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, isBot: true, botModelId: true, username: true },
    })
    if (!bot || !bot.isBot) return res.status(404).json({ error: 'Bot not found' })
    if (BUILTIN_BOT_USERNAMES.has(bot.username)) {
      return res.status(400).json({
        error: 'Built-in system bots (Rusty, Copper, Sterling, Magnus) cannot be deleted — they are the cloning source for all seeded tournament bots.',
      })
    }

    await db.$transaction(async (tx) => {
      await tx.game.deleteMany({ where: { player1Id: bot.id } })
      await tx.user.delete({ where: { id: bot.id } })
    })

    if (bot.botModelId) {
      await db.botSkill.delete({ where: { id: bot.botModelId } }).catch(() => {})
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

/**
 * GET /api/v1/admin/idle-config
 */
router.get('/idle-config', async (_req, res, next) => {
  try {
    const [idleWarnSeconds, idleGraceSeconds, spectatorIdleSeconds] = await Promise.all([
      getSystemConfig('game.idleWarnSeconds',      120),
      getSystemConfig('game.idleGraceSeconds',      60),
      getSystemConfig('game.spectatorIdleSeconds', 600),
    ])
    res.json({ idleWarnSeconds, idleGraceSeconds, spectatorIdleSeconds })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/v1/admin/idle-config
 */
router.patch('/idle-config', async (req, res, next) => {
  try {
    const { idleWarnSeconds, idleGraceSeconds, spectatorIdleSeconds } = req.body
    if (idleWarnSeconds !== undefined) {
      const v = parseInt(idleWarnSeconds)
      if (isNaN(v) || v < 10) return res.status(400).json({ error: 'idleWarnSeconds must be >= 10' })
      await setSystemConfig('game.idleWarnSeconds', v)
    }
    if (idleGraceSeconds !== undefined) {
      const v = parseInt(idleGraceSeconds)
      if (isNaN(v) || v < 10) return res.status(400).json({ error: 'idleGraceSeconds must be >= 10' })
      await setSystemConfig('game.idleGraceSeconds', v)
    }
    if (spectatorIdleSeconds !== undefined) {
      const v = parseInt(spectatorIdleSeconds)
      if (isNaN(v) || v < 10) return res.status(400).json({ error: 'spectatorIdleSeconds must be >= 10' })
      await setSystemConfig('game.spectatorIdleSeconds', v)
    }
    const [warn, grace, spec] = await Promise.all([
      getSystemConfig('game.idleWarnSeconds',      120),
      getSystemConfig('game.idleGraceSeconds',      60),
      getSystemConfig('game.spectatorIdleSeconds', 600),
    ])
    res.json({ idleWarnSeconds: warn, idleGraceSeconds: grace, spectatorIdleSeconds: spec })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/v1/admin/session-config
 */
router.get('/session-config', async (_req, res, next) => {
  try {
    const [idleWarnMinutes, idleGraceMinutes] = await Promise.all([
      getSystemConfig('session.idleWarnMinutes',  30),
      getSystemConfig('session.idleGraceMinutes',  5),
    ])
    res.json({ idleWarnMinutes, idleGraceMinutes })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/v1/admin/session-config
 */
router.patch('/session-config', async (req, res, next) => {
  try {
    const { idleWarnMinutes, idleGraceMinutes } = req.body
    if (idleWarnMinutes !== undefined) {
      const v = parseInt(idleWarnMinutes)
      if (isNaN(v) || v < 1) return res.status(400).json({ error: 'idleWarnMinutes must be >= 1' })
      await setSystemConfig('session.idleWarnMinutes', v)
    }
    if (idleGraceMinutes !== undefined) {
      const v = parseInt(idleGraceMinutes)
      if (isNaN(v) || v < 1) return res.status(400).json({ error: 'idleGraceMinutes must be >= 1' })
      await setSystemConfig('session.idleGraceMinutes', v)
    }
    const [warn, grace] = await Promise.all([
      getSystemConfig('session.idleWarnMinutes',  30),
      getSystemConfig('session.idleGraceMinutes',  5),
    ])
    res.json({ idleWarnMinutes: warn, idleGraceMinutes: grace })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/v1/admin/replay-config
 */
router.get('/replay-config', async (_req, res, next) => {
  try {
    const [casualRetentionDays, tournamentRetentionDays] = await Promise.all([
      getSystemConfig('replay.casualRetentionDays',    90),
      getSystemConfig('replay.tournamentRetentionDays', 90),
    ])
    res.json({ casualRetentionDays, tournamentRetentionDays })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/v1/admin/replay-config
 */
router.patch('/replay-config', async (req, res, next) => {
  try {
    const { casualRetentionDays, tournamentRetentionDays } = req.body
    if (casualRetentionDays !== undefined) {
      const v = parseInt(casualRetentionDays)
      if (isNaN(v) || v < 1) return res.status(400).json({ error: 'casualRetentionDays must be >= 1' })
      await setSystemConfig('replay.casualRetentionDays', v)
    }
    if (tournamentRetentionDays !== undefined) {
      const v = parseInt(tournamentRetentionDays)
      if (isNaN(v) || v < 1) return res.status(400).json({ error: 'tournamentRetentionDays must be >= 1' })
      await setSystemConfig('replay.tournamentRetentionDays', v)
    }
    const [casual, tournament] = await Promise.all([
      getSystemConfig('replay.casualRetentionDays',    90),
      getSystemConfig('replay.tournamentRetentionDays', 90),
    ])
    res.json({ casualRetentionDays: casual, tournamentRetentionDays: tournament })
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

/**
 * DELETE /api/v1/admin/tables/:id
 * Force-stop any table (mark COMPLETED + notify connected players).
 */
router.delete('/tables/:id', async (req, res, next) => {
  try {
    const table = await db.table.findUnique({ where: { id: req.params.id } })
    if (!table) return res.status(404).json({ error: 'Table not found' })

    await db.table.update({
      where: { id: req.params.id },
      data:  { status: 'COMPLETED' },
    })

    // End the game immediately for connected players so GameComponent transitions
    // to the finished state before the table.deleted navigation arrives.
    const scores = table.previewState?.scores ?? { X: 0, O: 0 }
    emitToRoom(`table:${table.id}`, 'game:forfeit', { winner: null, scores })

    // Bounce connected players/spectators back to the tables list.
    dispatch({
      type:    'table.deleted',
      targets: { broadcast: true },
      payload: { tableId: req.params.id, slug: table.slug },
    })

    res.json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'Admin force-stop table failed')
    next(err)
  }
})

export default router
