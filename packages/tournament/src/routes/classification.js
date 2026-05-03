/**
 * Classification admin routes.
 *
 * GET  /classification/players          — list all classifications (paginated)
 * GET  /classification/players/:userId  — get one player's classification + history
 * POST /classification/players/:userId/override  — admin: set tier manually
 *
 * GET  /classification/thresholds       — get merit threshold bands
 * PUT  /classification/thresholds       — update merit threshold bands
 *
 * GET  /classification/config           — get SystemConfig classification keys
 * PATCH /classification/config          — update SystemConfig classification keys
 */

import { Router } from 'express'
import db from '@xo-arena/db'
import { requireAuth, requireTournamentAdmin } from '../middleware/auth.js'
import { adminOverrideTier, useDemotionOptOut } from '../services/classificationService.js'
import logger from '../logger.js'

// ─── Self-service route (no admin required) ───────────────────────────────────

export const classificationMeRouter = Router()

classificationMeRouter.post('/demotion-opt-out', requireAuth, async (req, res) => {
  try {
    const user = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      select: { id: true },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })

    const updated = await useDemotionOptOut(user.id)
    res.json(updated)
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    logger.error({ err }, 'POST /classification/me/demotion-opt-out failed')
    res.status(500).json({ error: 'Internal server error' })
  }
})

classificationMeRouter.get('/', requireAuth, async (req, res) => {
  try {
    // Look up the internal User ID from the BetterAuth ID in the token
    const user = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      select: { id: true },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })

    const classification = await db.playerClassification.findUnique({
      where: { userId: user.id },
      include: {
        history: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    })
    if (!classification) return res.status(404).json({ error: 'No classification record' })

    res.json(classification)
  } catch (err) {
    logger.error({ err }, 'GET /classification/me failed')
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── Admin routes ─────────────────────────────────────────────────────────────

const router = Router()
router.use(requireAuth, requireTournamentAdmin)

// ─── Player classifications ───────────────────────────────────────────────────

router.get('/players', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const skip = (page - 1) * limit
    const tier = req.query.tier || undefined

    const [classifications, total] = await Promise.all([
      db.playerClassification.findMany({
        where: tier ? { tier } : undefined,
        include: { user: { select: { id: true, username: true, displayName: true, isBot: true } } },
        orderBy: [{ tier: 'desc' }, { merits: 'desc' }],
        skip,
        take: limit,
      }),
      db.playerClassification.count({ where: tier ? { tier } : undefined }),
    ])

    res.json({ classifications, total, page, limit })
  } catch (err) {
    logger.error({ err }, 'GET /classification/players failed')
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/players/:userId', async (req, res) => {
  try {
    const classification = await db.playerClassification.findUnique({
      where: { userId: req.params.userId },
      include: {
        user: { select: { id: true, username: true, displayName: true, isBot: true } },
        meritTx: { orderBy: { createdAt: 'desc' }, take: 20 },
        history: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    })
    if (!classification) return res.status(404).json({ error: 'Not found' })
    res.json(classification)
  } catch (err) {
    logger.error({ err }, 'GET /classification/players/:userId failed')
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/players/:userId/override', async (req, res) => {
  try {
    const { tier } = req.body
    if (!tier) return res.status(400).json({ error: 'tier is required' })
    const result = await adminOverrideTier(req.params.userId, tier)
    res.json(result)
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    logger.error({ err }, 'POST /classification/players/:userId/override failed')
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── Merit thresholds ─────────────────────────────────────────────────────────

router.get('/thresholds', async (req, res) => {
  try {
    const thresholds = await db.meritThreshold.findMany({ orderBy: { bandMin: 'asc' } })
    res.json(thresholds)
  } catch (err) {
    logger.error({ err }, 'GET /classification/thresholds failed')
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/thresholds', async (req, res) => {
  try {
    const bands = req.body
    if (!Array.isArray(bands)) return res.status(400).json({ error: 'Expected array' })

    // Replace all bands
    await db.meritThreshold.deleteMany()
    const created = await Promise.all(
      bands.map(b => db.meritThreshold.create({
        data: {
          bandMin: b.bandMin,
          bandMax: b.bandMax ?? null,
          pos1: b.pos1,
          pos2: b.pos2,
          pos3: b.pos3,
          pos4: b.pos4,
        },
      }))
    )
    res.json(created)
  } catch (err) {
    logger.error({ err }, 'PUT /classification/thresholds failed')
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── SystemConfig for classification ─────────────────────────────────────────

const CLASSIFICATION_CONFIG_KEYS = [
  'classification.tiers.RECRUIT.meritsRequired',
  'classification.tiers.CONTENDER.meritsRequired',
  'classification.tiers.VETERAN.meritsRequired',
  'classification.tiers.ELITE.meritsRequired',
  'classification.tiers.CHAMPION.meritsRequired',
  'classification.demotion.finishRatioThreshold',
  'classification.demotion.minQualifyingMatches',
  'classification.demotion.reviewCadenceDays',
  'classification.bestOverallBonus.minParticipants',
]

router.get('/config', async (req, res) => {
  try {
    const rows = await db.systemConfig.findMany({
      where: { key: { in: CLASSIFICATION_CONFIG_KEYS } },
    })
    const config = Object.fromEntries(rows.map(r => [r.key, r.value]))
    res.json(config)
  } catch (err) {
    logger.error({ err }, 'GET /classification/config failed')
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/config', async (req, res) => {
  try {
    const updates = req.body
    if (typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'Expected object' })
    }

    // Only allow known classification keys
    const filtered = Object.entries(updates).filter(([k]) => CLASSIFICATION_CONFIG_KEYS.includes(k))
    if (filtered.length === 0) return res.status(400).json({ error: 'No valid keys' })

    await Promise.all(
      filtered.map(([key, value]) =>
        db.systemConfig.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        })
      )
    )

    res.json({ updated: filtered.map(([k]) => k) })
  } catch (err) {
    logger.error({ err }, 'PATCH /classification/config failed')
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
