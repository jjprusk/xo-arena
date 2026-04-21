// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Web Push (Tier 3) subscription management.
 *
 *   GET    /api/v1/push/public-key         VAPID public key (no auth)
 *   POST   /api/v1/push/subscribe          upsert subscription for this user
 *   DELETE /api/v1/push/subscribe          remove subscription by endpoint
 *   GET    /api/v1/push/subscriptions      list subscriptions for this user
 *
 * A user can register multiple subscriptions (one per browser/device). The
 * `endpoint` is globally unique — upsert by endpoint so re-subscribing from
 * the same browser doesn't duplicate rows.
 */
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import db from '../lib/db.js'
import { getPublicVapidKey } from '../lib/pushService.js'
import logger from '../logger.js'

const router = Router()

// Public key — no auth required. Clients fetch this before calling
// pushManager.subscribe so the SW uses the right applicationServerKey.
router.get('/public-key', (req, res) => {
  const key = getPublicVapidKey()
  if (!key) return res.status(503).json({ error: 'Push not configured' })
  res.json({ publicKey: key })
})

// Resolve the app User.id from the BA session.
async function resolveAppUserId(req) {
  const user = await db.user.findUnique({
    where: { betterAuthId: req.auth.userId },
    select: { id: true },
  })
  return user?.id ?? null
}

router.post('/subscribe', requireAuth, async (req, res, next) => {
  try {
    const { endpoint, keys, userAgent } = req.body ?? {}
    if (typeof endpoint !== 'string' || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'endpoint and keys.{p256dh,auth} required' })
    }
    const userId = await resolveAppUserId(req)
    if (!userId) return res.status(404).json({ error: 'User not found' })

    const sub = await db.pushSubscription.upsert({
      where:  { endpoint },
      create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? null },
      update: { userId, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? null, lastUsedAt: new Date() },
    })
    logger.info({ userId, endpoint: endpoint.slice(0, 60) }, 'push subscription registered')
    res.json({ id: sub.id })
  } catch (err) {
    next(err)
  }
})

router.delete('/subscribe', requireAuth, async (req, res, next) => {
  try {
    const { endpoint } = req.body ?? {}
    if (typeof endpoint !== 'string') {
      return res.status(400).json({ error: 'endpoint required' })
    }
    const userId = await resolveAppUserId(req)
    if (!userId) return res.status(404).json({ error: 'User not found' })

    const { count } = await db.pushSubscription.deleteMany({ where: { userId, endpoint } })
    res.json({ removed: count })
  } catch (err) {
    next(err)
  }
})

router.get('/subscriptions', requireAuth, async (req, res, next) => {
  try {
    const userId = await resolveAppUserId(req)
    if (!userId) return res.status(404).json({ error: 'User not found' })
    const subs = await db.pushSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, endpoint: true, userAgent: true, createdAt: true, lastUsedAt: true },
    })
    res.json({ subscriptions: subs })
  } catch (err) {
    next(err)
  }
})

export default router
