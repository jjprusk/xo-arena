/**
 * Notification service — accomplishment detection, queuing, and email delivery.
 */
import { Resend } from 'resend'
import db from '../lib/db.js'
import { getUserCredits, getTierLimit } from './creditService.js'
import { achievementTemplate, tournamentMatchTemplate } from '../lib/emailTemplates.js'
import logger from '../logger.js'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FROM = process.env.EMAIL_FROM ?? 'noreply@aiarena.callidity.com'

const MILESTONE_SCORES = [100, 500, 2000]

/**
 * Determines whether a user currently has an active session (proxy for "online").
 * Uses active Better Auth sessions — consistent with the admin online status indicator.
 */
async function isUserOnline(userId) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { betterAuthId: true } })
  if (!user?.betterAuthId) return false
  const session = await db.baSession.findFirst({
    where: { userId: user.betterAuthId, expiresAt: { gt: new Date() } },
  })
  return !!session
}

/**
 * Insert a UserNotification row if no undelivered row with the same type + key already exists.
 * If the user is offline AND has emailAchievements=true, sends an achievement email via Resend
 * and sets emailedAt on the row.
 */
export async function queueNotification(userId, type, payload) {
  // Build dedup filter: add payload path match for types with multiple possible values
  const payloadFilter = type === 'tier_upgrade'
    ? { payload: { path: ['tier'], equals: payload.tier } }
    : type === 'credit_milestone'
      ? { payload: { path: ['score'], equals: payload.score } }
      : {}

  const existing = await db.userNotification.findFirst({
    where: { userId, type, deliveredAt: null, ...payloadFilter },
  })
  if (existing) return null

  const notification = await db.userNotification.create({
    data: { userId, type, payload },
  })

  // Non-fatal: attempt email delivery if user is offline and opted in
  try {
    const [online, user] = await Promise.all([
      isUserOnline(userId),
      db.user.findUnique({
        where: { id: userId },
        select: { email: true, displayName: true, emailAchievements: true },
      }),
    ])

    if (!online && user?.emailAchievements && resend) {
      let subject, html
      if (type === 'tournament_match_result') {
        subject = 'XO Arena — Match result'
        html = tournamentMatchTemplate({ name: user.displayName, payload })
      } else {
        subject = payload.message
          ? `XO Arena — ${payload.message}`
          : 'XO Arena — New achievement!'
        html = achievementTemplate({ name: user.displayName, type, payload })
      }
      await resend.emails.send({ from: FROM, to: user.email, subject, html })
      await db.userNotification.update({
        where: { id: notification.id },
        data: { emailedAt: new Date() },
      })
    }
  } catch (err) {
    logger.warn({ err, userId, type }, 'Achievement email failed (non-fatal)')
  }

  return notification
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
