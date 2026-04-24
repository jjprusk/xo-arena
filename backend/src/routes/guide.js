// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Guide preferences API — Intelligent Guide v1.
 *
 *   GET   /api/v1/guide/preferences        return journey progress + UI prefs
 *   PATCH /api/v1/guide/preferences        update prefs (slots, notif, uiHints)
 *   POST  /api/v1/guide/journey/restart    reset journey progress
 *
 * Changes vs legacy (see Intelligent_Guide_Requirements.md §4):
 *   - `POST /journey/step` (client-triggered step completion) REMOVED —
 *     all 7 steps now detected server-side at their trigger events
 *   - Auto-complete-on-hydration for step 1 REMOVED — new step 1 is
 *     "Play a PvAI game" (fires from games.js / socketHandler.js), not
 *     "first guide preferences fetch"
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import db from '../lib/db.js'
import { restartJourney } from '../services/journeyService.js'

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

    res.json({
      guideSlots:             prefs.guideSlots             ?? [],
      guideNotificationPrefs: prefs.guideNotificationPrefs ?? {},
      journeyProgress:        progress,
      uiHints:                prefs.uiHints                ?? {},
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

    const { guideSlots, guideNotificationPrefs, journeyProgress, uiHints } = req.body

    if (guideSlots !== undefined) {
      if (!Array.isArray(guideSlots))    return res.status(400).json({ error: 'guideSlots must be an array' })
      if (guideSlots.length > 8)         return res.status(400).json({ error: 'guideSlots cannot exceed 8 slots' })
    }

    const updated = {
      ...(user.preferences ?? {}),
      ...(guideSlots             !== undefined && { guideSlots }),
      ...(guideNotificationPrefs !== undefined && { guideNotificationPrefs }),
      ...(journeyProgress        !== undefined && { journeyProgress }),
      ...(uiHints                !== undefined && { uiHints }),
    }

    await db.user.update({ where: { id: user.id }, data: { preferences: updated } })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/v1/guide/journey/restart
 * Clears journey progress — used by "Restart onboarding" in Settings and by
 * `um journey --reset`. Does NOT re-lock SlotGrid or revoke already-granted
 * TC per requirements §9.3.
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
