/**
 * Better Auth central instance.
 * Mounted at /api/auth/* in app.js.
 */

import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { jwt } from 'better-auth/plugins'
import { admin } from 'better-auth/plugins'
import { Resend } from 'resend'
import db from './db.js'
import logger from '../logger.js'
import { syncUser } from '../services/userService.js'

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

const FROM = process.env.EMAIL_FROM || 'noreply@aiarena.callidity.com'

async function sendEmail({ to, subject, html }) {
  if (!resend) {
    logger.warn({ to, subject }, 'Email not sent — RESEND_API_KEY not set')
    return
  }
  try {
    await resend.emails.send({ from: FROM, to, subject, html })
    logger.info({ to, subject }, 'Email sent')
  } catch (err) {
    logger.error({ err: err.message, to, subject }, 'Failed to send email')
  }
}

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: 'postgresql',
  }),
  // Email + password is built-in — no plugin import needed
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Reset your XO Arena password',
        html: `<p>Hi ${user.name || user.email},</p>
               <p>Click the link below to reset your password. This link expires in 1 hour.</p>
               <p><a href="${url}">Reset password</a></p>
               <p>If you didn't request this, you can ignore this email.</p>`,
      })
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Verify your XO Arena email',
        html: `<p>Hi ${user.name || user.email},</p>
               <p>Click the link below to verify your email address.</p>
               <p><a href="${url}">Verify email</a></p>
               <p>If you didn't create an account, you can ignore this email.</p>`,
      })
    },
  },
  // Map BA's internal model names to our ba_* Prisma models
  user:         { modelName: 'baUser' },
  session:      { modelName: 'baSession' },
  account:      { modelName: 'baAccount' },
  verification: { modelName: 'baVerification' },
  plugins: [
    jwt(),
    admin({ adminRole: 'admin' }),
  ],
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
    }),
    ...(process.env.APPLE_CLIENT_ID && {
      apple: {
        clientId: process.env.APPLE_CLIENT_ID,
        clientSecret: process.env.APPLE_CLIENT_SECRET,
      },
    }),
  },
  secret: process.env.BETTER_AUTH_SECRET || 'dev-secret-change-in-production',
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  trustedOrigins: [
    ...(process.env.FRONTEND_URL || 'http://localhost:5173')
      .split(',').map(o => o.trim()).filter(Boolean),
    'https://appleid.apple.com',
  ],
  advanced: {
    crossSubdomainCookies: { enabled: false },
    cookies: {
      session_token: {
        attributes: {
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
          secure: process.env.NODE_ENV === 'production',
        },
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (baUser) => {
          try {
            await syncUser({
              betterAuthId: baUser.id,
              email: baUser.email,
              username: baUser.name?.toLowerCase().replace(/\s+/g, '_') || baUser.email.split('@')[0],
              displayName: baUser.name || baUser.email.split('@')[0],
              oauthProvider: 'email',
              avatarUrl: baUser.image || null,
            })
          } catch (err) {
            logger.warn({ err: err.message, userId: baUser.id }, 'Post-createUser domain upsert failed')
          }
        },
      },
    },
  },
})
