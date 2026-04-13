// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Public feedback submission route.
 * POST /api/v1/feedback
 */

import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { Resend } from 'resend'
import { optionalAuth } from '../middleware/auth.js'
import db from '../lib/db.js'
import logger from '../logger.js'
import { thankYouTemplate, staffAlertTemplate } from '../lib/emailTemplates.js'

const router = Router()

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

const FROM = process.env.EMAIL_FROM ?? 'noreply@aiarena.callidity.com'

const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 60 minutes
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many feedback submissions. Please try again later.' },
})

/**
 * POST /api/v1/feedback
 * Public (optional auth). Rate-limited: 3 per IP per 60 minutes.
 */
router.post('/', feedbackLimiter, optionalAuth, async (req, res, next) => {
  try {
    const { appId, category, message, pageUrl, screenshotData, userAgent } = req.body

    if (!message || !pageUrl) {
      return res.status(400).json({ error: 'message and pageUrl are required' })
    }

    // Resolve domain user if authenticated
    let userId = null
    let domainUser = null
    if (req.auth) {
      domainUser = await db.user.findUnique({
        where: { betterAuthId: req.auth.userId },
        select: { id: true, displayName: true, email: true, betterAuthId: true },
      })
      if (domainUser) userId = domainUser.id
    }

    const feedback = await db.feedback.create({
      data: {
        appId:          appId ?? 'xo-arena',
        userId,
        category:       category ?? 'OTHER',
        message,
        pageUrl,
        screenshotData: screenshotData ?? null,
        userAgent:      userAgent ?? req.headers['user-agent'] ?? null,
      },
    })

    // After save — non-fatal side-effects
    const feedbackAppId = feedback.appId

    // 1. Thank-you email for verified authenticated user
    if (domainUser && resend) {
      const baUser = await db.baUser.findUnique({
        where: { id: req.auth.userId },
        select: { emailVerified: true },
      }).catch(() => null)

      if (baUser?.emailVerified) {
        resend.emails.send({
          from: FROM,
          to: domainUser.email,
          subject: 'Thanks for your feedback — XO Arena',
          html: thankYouTemplate({
            name: domainUser.displayName,
            category: feedback.category,
            message: feedback.message,
          }),
        }).catch(err => logger.warn({ err: err.message }, 'Thank-you email failed (non-fatal)'))
      }
    }

    // 2. Emit Socket.io event to support room
    const io = req.app.get('io')
    if (io) {
      io.to('support').emit('feedback:new', {
        id:      feedback.id,
        category: feedback.category,
        appId:   feedbackAppId,
        pageUrl: feedback.pageUrl,
      })
    }

    // 3. Staff alert emails to all ADMIN/SUPPORT users with verified emails
    if (resend) {
      const staffUsers = await db.user.findMany({
        where: {
          userRoles: { some: { role: { in: ['ADMIN', 'SUPPORT'] } } },
        },
        select: { betterAuthId: true, email: true, displayName: true },
      }).catch(() => [])

      const baIds = staffUsers.map(u => u.betterAuthId).filter(Boolean)
      const verifiedBaUsers = baIds.length
        ? await db.baUser.findMany({
            where: { id: { in: baIds }, emailVerified: true },
            select: { id: true },
          }).catch(() => [])
        : []
      const verifiedSet = new Set(verifiedBaUsers.map(b => b.id))

      const staffWithVerifiedEmail = staffUsers.filter(u => u.betterAuthId && verifiedSet.has(u.betterAuthId))

      const alertHtml = staffAlertTemplate({
        category: feedback.category,
        message:  feedback.message,
        pageUrl:  feedback.pageUrl,
        appId:    feedbackAppId,
      })

      await Promise.allSettled(
        staffWithVerifiedEmail.map(staff =>
          resend.emails.send({
            from:    FROM,
            to:      staff.email,
            subject: `[${feedbackAppId}] New ${feedback.category} feedback`,
            html:    alertHtml,
          })
        )
      )
    }

    res.status(201).json({ id: feedback.id })
  } catch (err) {
    next(err)
  }
})

export default router
