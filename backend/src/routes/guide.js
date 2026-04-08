/**
 * Guide preferences API
 *
 * GET  /api/v1/guide/preferences  — return guideSlots, guideNotificationPrefs, journeyProgress
 * PATCH /api/v1/guide/preferences — update one or more of those fields
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import db from '../lib/db.js'
import { completeStep, restartJourney } from '../services/journeyService.js'

const router = Router()

router.get('/preferences', requireAuth, async (req, res, next) => {
  try {
    const user = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      select: { preferences: true },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })

    const prefs    = user.preferences ?? {}
    const progress = prefs.journeyProgress ?? { completedSteps: [], dismissedAt: null }

    // Auto-complete step 1 (Welcome) on first hydration
    if (!progress.completedSteps.includes(1)) {
      await completeStep(user.id, 1)
      // Re-read so the response reflects the freshly written value
      const fresh   = await db.user.findUnique({ where: { id: user.id }, select: { preferences: true } })
      const updated = fresh?.preferences?.journeyProgress ?? { completedSteps: [1], dismissedAt: null }
      return res.json({
        guideSlots:             prefs.guideSlots             ?? [],
        guideNotificationPrefs: prefs.guideNotificationPrefs ?? {},
        journeyProgress:        updated,
      })
    }

    res.json({
      guideSlots:             prefs.guideSlots             ?? [],
      guideNotificationPrefs: prefs.guideNotificationPrefs ?? {},
      journeyProgress:        progress,
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

/**
 * POST /api/v1/guide/journey/step
 * Client-side trigger for steps that can't be detected server-side (currently step 3).
 * Body: { step: number }
 */
router.post('/journey/step', requireAuth, async (req, res, next) => {
  try {
    const user = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      select: { id: true },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })

    const { step } = req.body
    const CLIENT_TRIGGERABLE = [3]   // only client-side steps
    if (!CLIENT_TRIGGERABLE.includes(step)) {
      return res.status(400).json({ error: 'Step cannot be triggered client-side' })
    }

    await completeStep(user.id, step)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/v1/guide/journey/restart
 * Clears all journey progress — used by "Restart onboarding" in Settings.
 */
router.post('/journey/restart', requireAuth, async (req, res, next) => {
  try {
    const user = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      select: { id: true },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })

    await restartJourney(user.id)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
