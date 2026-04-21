// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Web Push (Tier 3) — sendToUser() fans out a notification payload to every
 * registered subscription for a user. Dead endpoints (HTTP 404/410) are
 * auto-purged from the DB so they don't keep incurring retries.
 *
 * VAPID keys come from env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
 * VAPID_CONTACT_EMAIL (must be a `mailto:` URL or an https URL per RFC 8292).
 *
 * Payload shape delivered to the service worker:
 *   { type, title, body, url?, data? }
 *
 * `type` maps 1:1 to the notificationBus REGISTRY event type so the SW can
 * key off it for icon/tag selection. `url` is where to focus/open on click.
 */
import webPush from 'web-push'
import db from './db.js'
import logger from '../logger.js'

let _configured = false
function ensureConfigured() {
  if (_configured) return true
  const publicKey  = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const contact    = process.env.VAPID_CONTACT_EMAIL
  if (!publicKey || !privateKey || !contact) {
    logger.warn('VAPID keys or contact email missing — push disabled')
    return false
  }
  webPush.setVapidDetails(contact, publicKey, privateKey)
  _configured = true
  return true
}

/**
 * Send `payload` to every registered subscription of `userId`.
 * Returns { sent, removed } counts; never throws.
 */
export async function sendToUser(userId, payload) {
  if (!ensureConfigured()) return { sent: 0, removed: 0 }
  if (!userId || !payload) return { sent: 0, removed: 0 }

  let subs = []
  try {
    subs = await db.pushSubscription.findMany({ where: { userId } })
  } catch (err) {
    logger.warn({ err, userId }, 'pushService: findMany failed (non-fatal)')
    return { sent: 0, removed: 0 }
  }
  if (subs.length === 0) return { sent: 0, removed: 0 }

  const body = JSON.stringify(payload)
  let sent = 0
  const deadIds = []
  await Promise.all(subs.map(async (s) => {
    try {
      await webPush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
      )
      sent++
    } catch (err) {
      // 404 / 410 from push service = endpoint gone (unsubscribed or expired).
      const status = err?.statusCode
      if (status === 404 || status === 410) {
        deadIds.push(s.id)
      } else {
        logger.warn({ err, userId, endpoint: s.endpoint.slice(0, 60) }, 'pushService: send failed')
      }
    }
  }))

  if (deadIds.length > 0) {
    try {
      await db.pushSubscription.deleteMany({ where: { id: { in: deadIds } } })
    } catch (err) {
      logger.warn({ err, deadIds }, 'pushService: purge failed (non-fatal)')
    }
  }

  if (sent > 0) {
    await db.pushSubscription.updateMany({
      where: { userId, id: { in: subs.map(s => s.id).filter(id => !deadIds.includes(id)) } },
      data: { lastUsedAt: new Date() },
    }).catch(() => {})
  }

  return { sent, removed: deadIds.length }
}

/** Exposed to routes so the public key can be served to the client SW. */
export function getPublicVapidKey() {
  return process.env.VAPID_PUBLIC_KEY ?? null
}

/**
 * Map a notificationBus event (type + payload) into the SW notification
 * shape. Only covers push-eligible types; unknown types return null so the
 * caller can skip the send.
 */
export function buildPushPayload(type, payload = {}) {
  const name = payload?.name ?? 'Tournament'
  const tid  = payload?.tournamentId ?? null
  switch (type) {
    case 'match.ready':
      return {
        type,
        title: 'Match ready',
        body: `Your match in ${name} is ready to play`,
        url: tid ? `/tournaments/${tid}` : '/tournaments',
      }
    case 'tournament.starting_soon': {
      const m = payload?.minutesUntilStart
      return {
        type,
        title: `${name} starting soon`,
        body: m ? `Starts in ${m} minutes` : 'Starting soon',
        url: tid ? `/tournaments/${tid}` : '/tournaments',
      }
    }
    case 'tournament.started':
      return {
        type,
        title: `${name} has started`,
        body: 'Check your first match',
        url: tid ? `/tournaments/${tid}` : '/tournaments',
      }
    case 'tournament.cancelled':
      return {
        type,
        title: `${name} cancelled`,
        body: 'The tournament was cancelled',
        url: '/tournaments',
      }
    case 'achievement.tier_upgrade':
      return {
        type,
        title: `Tier upgrade${payload?.tier ? ` — ${payload.tier}` : ''}`,
        body: payload?.message ?? 'Your rank went up',
        url: '/profile',
      }
    default:
      return null
  }
}

/** Test hook: reset configured flag so tests can swap env between cases. */
export function _resetForTests() {
  _configured = false
}
