// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { Router } from 'express'
import db from '../lib/db.js'
import { requireAuth, requireTournamentAdmin } from '../middleware/auth.js'

const router = Router()

// GET /api/recurring/my
// Returns every standing (non-opted-out) recurring registration for the
// authenticated user, with enough template info to render a "My subscriptions"
// list: template name, status, recurrence details, and when the user opted in.
router.get('/my', requireAuth, async (req, res, next) => {
  try {
    const userId = req.auth.dbUserId
    const registrations = await db.recurringTournamentRegistration.findMany({
      where: { userId, optedOutAt: null },
      orderBy: { createdAt: 'desc' },
    })
    if (registrations.length === 0) return res.json({ subscriptions: [] })

    const templates = await db.tournamentTemplate.findMany({
      where: { id: { in: registrations.map(r => r.templateId) } },
      select: {
        id: true, name: true, description: true, game: true, mode: true,
        recurrenceInterval: true, recurrenceEndDate: true, paused: true,
        recurrenceStart: true, bestOfN: true, maxParticipants: true,
      },
    })
    const byId = Object.fromEntries(templates.map(t => [t.id, t]))
    const subscriptions = registrations
      .map(r => byId[r.templateId] ? { ...r, template: byId[r.templateId] } : null)
      .filter(Boolean)
    res.json({ subscriptions })
  } catch (e) { next(e) }
})

// POST /api/recurring/:templateId/register
router.post('/:templateId/register', requireAuth, async (req, res, next) => {
  try {
    const { templateId } = req.params
    const userId = req.auth.dbUserId

    const registration = await db.recurringTournamentRegistration.upsert({
      where: { templateId_userId: { templateId, userId } },
      create: { templateId, userId },
      update: {
        optedOutAt: null,
        missedCount: 0,
      },
    })

    res.status(201).json({ registration })
  } catch (e) {
    next(e)
  }
})

// DELETE /api/recurring/:templateId/register
router.delete('/:templateId/register', requireAuth, async (req, res, next) => {
  try {
    const { templateId } = req.params
    const userId = req.auth.dbUserId

    const registration = await db.recurringTournamentRegistration.findUnique({
      where: { templateId_userId: { templateId, userId } },
    })

    if (!registration) return res.status(404).json({ error: 'Registration not found' })

    await db.recurringTournamentRegistration.update({
      where: { templateId_userId: { templateId, userId } },
      data: { optedOutAt: new Date() },
    })

    res.status(204).send()
  } catch (e) {
    next(e)
  }
})

// GET /api/recurring/:templateId/registrations
router.get('/:templateId/registrations', requireTournamentAdmin, async (req, res, next) => {
  try {
    const { templateId } = req.params

    const registrations = await db.recurringTournamentRegistration.findMany({
      where: {
        templateId,
        optedOutAt: null,
      },
    })

    // Fetch user info for each registration
    const userIds = registrations.map(r => r.userId)
    const users = await db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, displayName: true, avatarUrl: true },
    })

    const userMap = Object.fromEntries(users.map(u => [u.id, u]))

    const enriched = registrations.map(r => ({
      ...r,
      user: userMap[r.userId] ?? null,
    }))

    res.json({ registrations: enriched })
  } catch (e) {
    next(e)
  }
})

export default router
