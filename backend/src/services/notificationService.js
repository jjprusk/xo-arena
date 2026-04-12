/**
 * Notification service — accomplishment detection, queuing, and email delivery.
 */
import { Resend } from 'resend'
import db from '../lib/db.js'
import { getUserCredits, getTierLimit } from './creditService.js'
import { achievementTemplate, tournamentMatchTemplate } from '../lib/emailTemplates.js'
import logger from '../logger.js'
import { dispatch } from '../lib/notificationBus.js'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FROM = process.env.EMAIL_FROM ?? 'noreply@aiarena.callidity.com'

const MILESTONE_SCORES = [100, 500, 2000]

// Old type → new bus type key mapping
const TYPE_MAP = {
  tier_upgrade:             'achievement.tier_upgrade',
  credit_milestone:         'achievement.milestone',
  first_hpc:                'achievement.milestone',
  first_bpc:                'achievement.milestone',
  first_tc:                 'achievement.milestone',
  system_alert:             'system.alert',
  tournament_match_ready:   'match.ready',
  tournament_match_result:  'match.result',
  tournament_starting_soon: 'tournament.starting_soon',
  tournament_completed:     'tournament.completed',
  tournament_cancelled:     'tournament.cancelled',
}

/**
 * Determines whether a user currently has an active session (proxy for "online").
 * Uses active Better Auth sessions — consistent with the admin online status indicator.
 */
export async function isUserOnline(userId) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { betterAuthId: true } })
  if (!user?.betterAuthId) return false
  const session = await db.baSession.findFirst({
    where: { userId: user.betterAuthId, expiresAt: { gt: new Date() } },
  })
  return !!session
}

/**
 * Email delivery helper — looks up user, builds subject/html, sends via Resend.
 * Called by dispatch() in a future phase for email delivery.
 * @returns {Promise<void>}
 */
export async function sendEmail(userId, type, payload) {
  if (!resend) return
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, displayName: true },
  })
  if (!user?.email) return

  let subject, html
  if (type === 'match.result' || type === 'tournament_match_result') {
    subject = 'XO Arena — Match result'
    html = tournamentMatchTemplate({ name: user.displayName, payload })
  } else {
    subject = payload.message
      ? `XO Arena — ${payload.message}`
      : 'XO Arena — New achievement!'
    html = achievementTemplate({ name: user.displayName, type, payload })
  }

  return resend.emails.send({ from: FROM, to: user.email, subject, html })
}

/**
 * Thin adapter — maps legacy type string to new bus key and calls dispatch().
 * Kept exported so existing callers (tournamentBridge.js) still work without changes.
 */
export async function queueNotification(userId, type, payload) {
  const newType = TYPE_MAP[type]
  if (!newType) {
    logger.warn({ type }, 'queueNotification: unknown legacy type — skipping')
    return null
  }
  return dispatch({ type: newType, targets: { userId }, payload })
}

/**
 * Compare credits before and after an event; queue notifications for any tier upgrade,
 * first-credit milestone, or activity score milestone that occurred.
 * previousCredits: snapshot taken immediately before the credit increment.
 */
export async function checkAndNotify(userId, previousCredits) {
  const current = await getUserCredits(userId)
  const jobs = []

  // Tier upgrade
  if (current.tier > previousCredits.tier) {
    const botLimit = await getTierLimit(userId, 'bots')
    const limitText = botLimit === 0 ? 'unlimited' : String(botLimit)
    jobs.push(queueNotification(userId, 'tier_upgrade', {
      tier: current.tier,
      tierName: current.tierName,
      tierIcon: current.tierIcon,
      unlockedLimits: { bots: botLimit },
      message: `You've reached ${current.tierIcon} ${current.tierName}! Your bot limit is now ${limitText}.`,
    }))
  }

  // First credits of each type
  if (previousCredits.hpc === 0 && current.hpc > 0) {
    jobs.push(queueNotification(userId, 'first_hpc', {
      message: 'First PvP game recorded — human play credits are now tracking.',
    }))
  }
  if (previousCredits.bpc === 0 && current.bpc > 0) {
    jobs.push(queueNotification(userId, 'first_bpc', {
      message: 'Your bot played its first external game — bot play credits are now tracking.',
    }))
  }
  if (previousCredits.tc === 0 && current.tc > 0) {
    jobs.push(queueNotification(userId, 'first_tc', {
      message: 'You entered your first tournament — tournament credits are now tracking.',
    }))
  }

  // Activity score milestones
  for (const milestone of MILESTONE_SCORES) {
    if (previousCredits.activityScore < milestone && current.activityScore >= milestone) {
      jobs.push(queueNotification(userId, 'credit_milestone', {
        score: milestone,
        message: `You've earned ${milestone} activity points!`,
      }))
    }
  }

  const results = await Promise.allSettled(jobs)
  return results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value)
}
