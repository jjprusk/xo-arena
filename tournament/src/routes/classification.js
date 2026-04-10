import { Router } from 'express'
import db from '../lib/db.js'
import { optionalAuth, requireAuth, requireAdmin } from '../middleware/auth.js'

const router = Router()

const TIER_ORDER = ['RECRUIT', 'CONTENDER', 'VETERAN', 'ELITE', 'CHAMPION', 'LEGEND']

// GET /api/classification/players
router.get('/players', optionalAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50))
    const { tier } = req.query

    const where = {}
    if (tier) where.tier = tier

    const [players, total] = await Promise.all([
      db.playerClassification.findMany({
        where,
        include: {
          user: { select: { id: true, displayName: true, avatarUrl: true, eloRating: true } },
        },
        orderBy: [{ merits: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.playerClassification.count({ where }),
    ])

    // Sort by merits desc then tier order desc (within same merits, higher tier wins)
    const sorted = players.sort((a, b) => {
      if (b.merits !== a.merits) return b.merits - a.merits
      return TIER_ORDER.indexOf(b.tier) - TIER_ORDER.indexOf(a.tier)
    })

    res.json({ players: sorted, total, page, limit })
  } catch (e) {
    next(e)
  }
})

// GET /api/classification/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const classification = await db.playerClassification.findUnique({
      where: { userId: req.auth.dbUserId },
      include: {
        meritTx: { orderBy: { createdAt: 'desc' }, take: 10 },
        history: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    })

    res.json({ classification: classification ?? null })
  } catch (e) {
    next(e)
  }
})

// POST /api/classification/me/demotion-opt-out
router.post('/me/demotion-opt-out', requireAuth, async (req, res, next) => {
  try {
    const classification = await db.playerClassification.findUnique({
      where: { userId: req.auth.dbUserId },
    })

    if (!classification) return res.status(404).json({ error: 'Classification not found' })
    if (classification.demotionOptOutUsedAt) {
      return res.status(400).json({ error: 'Demotion opt-out has already been used' })
    }

    const updated = await db.playerClassification.update({
      where: { userId: req.auth.dbUserId },
      data: { demotionOptOutUsedAt: new Date() },
    })

    res.json({ classification: updated })
  } catch (e) {
    next(e)
  }
})

// GET /api/classification/players/:userId
router.get('/players/:userId', optionalAuth, async (req, res, next) => {
  try {
    const classification = await db.playerClassification.findUnique({
      where: { userId: req.params.userId },
      include: {
        history: { orderBy: { createdAt: 'desc' }, take: 20 },
        meritTx: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    })

    res.json({ classification: classification ?? null })
  } catch (e) {
    next(e)
  }
})

// POST /api/classification/players/:userId/override
router.post('/players/:userId/override', requireAdmin, async (req, res, next) => {
  try {
    const { tier } = req.body
    const { userId } = req.params

    if (!tier) return res.status(400).json({ error: 'tier is required' })

    const existing = await db.playerClassification.findUnique({
      where: { userId },
    })

    const classification = await db.playerClassification.upsert({
      where: { userId },
      create: { userId, tier },
      update: { tier },
    })

    await db.classificationHistory.create({
      data: {
        classificationId: classification.id,
        fromTier: existing?.tier ?? null,
        toTier: tier,
        reason: 'admin_override',
      },
    })

    res.json({ classification })
  } catch (e) {
    next(e)
  }
})

// GET /api/classification/thresholds
router.get('/thresholds', optionalAuth, async (req, res, next) => {
  try {
    const thresholds = await db.meritThreshold.findMany({
      orderBy: { bandMin: 'asc' },
    })

    res.json({ thresholds })
  } catch (e) {
    next(e)
  }
})

// PUT /api/classification/thresholds
router.put('/thresholds', requireAdmin, async (req, res, next) => {
  try {
    const { thresholds } = req.body

    if (!Array.isArray(thresholds)) {
      return res.status(400).json({ error: 'thresholds must be an array' })
    }

    const result = await db.$transaction(async (tx) => {
      await tx.meritThreshold.deleteMany()
      return tx.meritThreshold.createMany({
        data: thresholds.map(t => ({
          bandMin: t.bandMin,
          bandMax: t.bandMax ?? null,
          pos1: t.pos1,
          pos2: t.pos2,
          pos3: t.pos3,
          pos4: t.pos4,
        })),
      })
    })

    const created = await db.meritThreshold.findMany({ orderBy: { bandMin: 'asc' } })
    res.json({ thresholds: created })
  } catch (e) {
    next(e)
  }
})

// GET /api/classification/config
router.get('/config', optionalAuth, async (req, res, next) => {
  try {
    const record = await db.systemConfig.findUnique({
      where: { key: 'classification.config' },
    })

    res.json({ config: record?.value ?? {} })
  } catch (e) {
    next(e)
  }
})

// PATCH /api/classification/config
router.patch('/config', requireAdmin, async (req, res, next) => {
  try {
    const patch = req.body

    const existing = await db.systemConfig.findUnique({
      where: { key: 'classification.config' },
    })

    const merged = { ...(existing?.value ?? {}), ...patch }

    const record = await db.systemConfig.upsert({
      where: { key: 'classification.config' },
      create: { key: 'classification.config', value: merged },
      update: { value: merged },
    })

    res.json({ config: record.value })
  } catch (e) {
    next(e)
  }
})

export default router
