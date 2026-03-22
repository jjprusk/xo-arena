import { Router } from 'express'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import db from '../lib/db.js'
import { deleteModel, getSystemConfig, setSystemConfig } from '../services/mlService.js'

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
      db.user.count(),
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

    const where = search
      ? {
          OR: [
            { displayName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { username: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}

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
          roles: true,
          mlModelLimit: true,
          createdAt: true,
          _count: { select: { gamesAsPlayer1: true } },
        },
      }),
      db.user.count({ where }),
    ])

    // Fetch BA roles for all users in one query
    const baIds = rawUsers.map(u => u.betterAuthId).filter(Boolean)
    const baUsers = baIds.length
      ? await db.baUser.findMany({ where: { id: { in: baIds } }, select: { id: true, role: true } })
      : []
    const baRoleMap = Object.fromEntries(baUsers.map(b => [b.id, b.role]))

    const users = rawUsers.map(u => ({
      ...u,
      baRole: baRoleMap[u.betterAuthId] ?? null,
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
    const { banned, eloRating, mlModelLimit, roles, baRole } = req.body

    const data = {}
    if (banned !== undefined) data.banned = Boolean(banned)
    if (eloRating !== undefined) {
      const elo = parseFloat(eloRating)
      if (isNaN(elo) || elo < 0 || elo > 5000) {
        return res.status(400).json({ error: 'eloRating must be between 0 and 5000' })
      }
      data.eloRating = elo
    }
    if (mlModelLimit !== undefined) {
      if (mlModelLimit === null) {
        data.mlModelLimit = null  // reset to default
      } else {
        const v = parseInt(mlModelLimit)
        if (isNaN(v) || v < 0) return res.status(400).json({ error: 'mlModelLimit must be a non-negative integer or null' })
        data.mlModelLimit = v
      }
    }
    if (roles !== undefined) {
      const VALID_ROLES = ['tournament']
      const cleaned = Array.isArray(roles) ? roles.filter(r => VALID_ROLES.includes(r)) : []
      data.roles = cleaned
    }

    // Update domain user
    let user = null
    if (Object.keys(data).length > 0) {
      user = await db.user.update({ where: { id: req.params.id }, data, select: {
        id: true, betterAuthId: true, username: true, displayName: true,
        email: true, avatarUrl: true, eloRating: true, banned: true,
        roles: true, mlModelLimit: true, createdAt: true,
        _count: { select: { gamesAsPlayer1: true } },
      }})
    } else {
      user = await db.user.findUnique({ where: { id: req.params.id }, select: {
        id: true, betterAuthId: true, username: true, displayName: true,
        email: true, avatarUrl: true, eloRating: true, banned: true,
        roles: true, mlModelLimit: true, createdAt: true,
        _count: { select: { gamesAsPlayer1: true } },
      }})
      if (!user) return res.status(404).json({ error: 'User not found' })
    }

    // Update BA role (admin flag) if requested
    let baRole_ = null
    if (baRole !== undefined && user.betterAuthId) {
      const VALID_BA_ROLES = ['admin', null]
      if (!VALID_BA_ROLES.includes(baRole)) {
        return res.status(400).json({ error: 'baRole must be "admin" or null' })
      }
      const updated = await db.baUser.update({
        where: { id: user.betterAuthId },
        data: { role: baRole },
        select: { role: true },
      })
      baRole_ = updated.role
    } else if (user.betterAuthId) {
      const ba = await db.baUser.findUnique({ where: { id: user.betterAuthId }, select: { role: true } })
      baRole_ = ba?.role ?? null
    }

    res.json({ user: { ...user, baRole: baRole_ } })
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
    await db.user.delete({ where: { id: req.params.id } })
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

    // Enrich with creator display names
    const creatorIds = [...new Set(models.map(m => m.createdBy).filter(Boolean))]
    const creators = creatorIds.length
      ? await db.user.findMany({
          where: { betterAuthId: { in: creatorIds } },
          select: { betterAuthId: true, displayName: true, username: true },
        })
      : []
    const creatorMap = Object.fromEntries(creators.map(u => [u.betterAuthId, u]))

    const enriched = models.map(m => ({
      ...m,
      creatorName: m.createdBy
        ? (creatorMap[m.createdBy]?.displayName || creatorMap[m.createdBy]?.username || 'Unknown')
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
 */
router.delete('/ml/models/:id', async (req, res, next) => {
  try {
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

export default router
