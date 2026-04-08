/**
 * Guide preferences API
 *
 * GET  /api/v1/guide/preferences  — return guideSlots, guideNotificationPrefs, journeyProgress
 * PATCH /api/v1/guide/preferences — update one or more of those fields
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import db from '../lib/db.js'

const router = Router()

router.get('/preferences', requireAuth, async (req, res, next) => {
  try {
    const user = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      select: { preferences: true },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })

    const prefs = user.preferences ?? {}
    res.json({
      guideSlots:             prefs.guideSlots             ?? [],
      guideNotificationPrefs: prefs.guideNotificationPrefs ?? {},
      journeyProgress:        prefs.journeyProgress        ?? { completedSteps: [], dismissedAt: null },
    })
  } catch (err) {
    next(err)
  }
})

router.patch('/preferences', requireAuth, async (req, res, next) => {
  try {
    const user = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      select: { id: true, preferences: true },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })

    const { guideSlots, guideNotificationPrefs, journeyProgress } = req.body

    if (guideSlots !== undefined) {
      if (!Array.isArray(guideSlots))    return res.status(400).json({ error: 'guideSlots must be an array' })
      if (guideSlots.length > 8)         return res.status(400).json({ error: 'guideSlots cannot exceed 8 slots' })
    }

    const updated = {
      ...(user.preferences ?? {}),
      ...(guideSlots             !== undefined && { guideSlots }),
      ...(guideNotificationPrefs !== undefined && { guideNotificationPrefs }),
      ...(journeyProgress        !== undefined && { journeyProgress }),
    }

    await db.user.update({ where: { id: user.id }, data: { preferences: updated } })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
