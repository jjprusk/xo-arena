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
// Admin lookup. ?includeOptedOut=true returns users who have opted out so
// admins can audit the full subscriber history; default hides them so the
// UI defaults match the standing-subscription semantics used elsewhere.
router.get('/:templateId/registrations', requireTournamentAdmin, async (req, res, next) => {
  try {
    const { templateId } = req.params
    const includeOptedOut = req.query.includeOptedOut === 'true' || req.query.includeOptedOut === '1'

    const registrations = await db.recurringTournamentRegistration.findMany({
      where: {
        templateId,
        ...(includeOptedOut ? {} : { optedOutAt: null }),
      },
      orderBy: [{ optedOutAt: 'asc' }, { createdAt: 'asc' }],
    })

    const userIds = registrations.map(r => r.userId)
    const users = await db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, displayName: true, avatarUrl: true, isBot: true },
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

// POST /api/recurring/:templateId/registrations
// Admin enrol — opt a user *in* (or undo a prior opt-out). Body accepts
// either { userId } or { username }; one is required. Idempotent: if the
// user is already registered (and not opted out), no-op returns the
// existing row.
router.post('/:templateId/registrations', requireTournamentAdmin, async (req, res, next) => {
  try {
    const { templateId } = req.params
    const { userId: bodyUserId, username } = req.body ?? {}

    let userId = typeof bodyUserId === 'string' && bodyUserId.trim() ? bodyUserId.trim() : null
    if (!userId && typeof username === 'string' && username.trim()) {
      const u = await db.user.findFirst({
        where:  { username: username.trim() },
        select: { id: true },
      })
      if (!u) return res.status(404).json({ error: `No user with username "${username.trim()}"` })
      userId = u.id
    }
    if (!userId) return res.status(400).json({ error: 'userId or username is required' })

    // Verify the template exists so we don't silently create orphan rows.
    const template = await db.tournamentTemplate.findUnique({ where: { id: templateId }, select: { id: true } })
    if (!template) return res.status(404).json({ error: 'Template not found' })

    const registration = await db.recurringTournamentRegistration.upsert({
      where:  { templateId_userId: { templateId, userId } },
      create: { templateId, userId },
      update: { optedOutAt: null, missedCount: 0 },
    })
    res.status(201).json({ registration })
  } catch (e) {
    next(e)
  }
})

// DELETE /api/recurring/:templateId/registrations/:userId
// Admin opt-out — sets optedOutAt rather than hard-deleting so missed-count
// history survives. Idempotent.
router.delete('/:templateId/registrations/:userId', requireTournamentAdmin, async (req, res, next) => {
  try {
    const { templateId, userId } = req.params
    const existing = await db.recurringTournamentRegistration.findUnique({
      where: { templateId_userId: { templateId, userId } },
    })
    if (!existing) return res.status(404).json({ error: 'Registration not found' })
    if (existing.optedOutAt) return res.status(204).send()

    await db.recurringTournamentRegistration.update({
      where: { templateId_userId: { templateId, userId } },
      data:  { optedOutAt: new Date() },
    })
    res.status(204).send()
  } catch (e) {
    next(e)
  }
})

export default router
