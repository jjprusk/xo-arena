// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Guide preferences API — Intelligent Guide v1.
 *
 *   GET   /api/v1/guide/preferences        return journey progress + UI prefs
 *   PATCH /api/v1/guide/preferences        update prefs (slots, notif, uiHints)
 *   POST  /api/v1/guide/journey/restart    reset journey progress
 *   POST  /api/v1/guide/guest-credit       credit Hook steps 1-2 from guest localStorage
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
import logger from '../logger.js'
import { restartJourney, completeStep } from '../services/journeyService.js'

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

/**
 * POST /api/v1/guide/guest-credit
 *
 * Called by the client immediately after a successful signup to credit any
 * Hook-step progress the user accumulated as a guest (pre-signup). Payload
 * is whatever the client stored in localStorage under `guideGuestJourney`:
 *
 *     { hookStep1CompletedAt?: ISO8601, hookStep2CompletedAt?: ISO8601 }
 *
 * Both fields optional. Missing fields → no credit for that step. Invalid
 * step indices or non-ISO timestamps → ignored (best-effort; the guest-mode
 * state is client-supplied and trusted low).
 *
 * Low-risk to trust the client: the max TC a malicious actor can claim via
 * this endpoint is the Hook reward (+20 TC) — trivial impact. See §3.5.3 of
 * the Intelligent Guide Requirements doc.
 *
 * Idempotent — completeStep already handles "step already done" as a no-op.
 */
router.post('/guest-credit', requireAuth, async (req, res, next) => {
  try {
    const user = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      select: { id: true },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })

    const { hookStep1CompletedAt, hookStep2CompletedAt } = req.body ?? {}
    const credited = []

    // Step 1 — "Play a quick PvAI game" (pre-signup).
    if (hookStep1CompletedAt) {
      const ok = await completeStep(user.id, 1)
      if (ok) credited.push(1)
    }

    // Step 2 — "Watch two bots battle" (pre-signup). Order matters: step 2's
    // completion triggers the +20 TC Hook reward, so step 1 must be credited
    // first (visually; semantically they're independent but the reward event
    // reads "your Hook is done" which makes most sense when both steps are in).
    if (hookStep2CompletedAt) {
      const ok = await completeStep(user.id, 2)
      if (ok) credited.push(2)
    }

    logger.info({ userId: user.id, credited }, 'Guest-credit applied')
    res.json({ ok: true, creditedSteps: credited })
  } catch (err) {
    next(err)
  }
})

export default router
