// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Better Auth central instance.
 * Mounted at /api/auth/* in app.js.
 */

import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { jwt } from 'better-auth/plugins'
import { admin } from 'better-auth/plugins'
import { Resend } from 'resend'
import crypto from 'node:crypto'
import { promisify } from 'node:util'
import db from './db.js'
import logger from '../logger.js'
import { syncUser } from '../services/userService.js'

// Node.js's crypto.scrypt runs native code in the libuv thread pool — non-blocking
// and ~10-50x faster than a pure-JS implementation for the same params.
//
// In dev we use lighter params (N:4096, r:8) vs prod (N:16384, r:16) and prefix
// dev hashes with "d$" so the verifier can pick the right params. Existing prod
// hashes (no prefix) always verify with the heavier params.
const scrypt = promisify(crypto.scrypt)
const DEV = process.env.NODE_ENV === 'development'

const SCRYPT_PROD = { N: 16384, r: 16, p: 1 }
const SCRYPT_DEV  = { N: 4096,  r: 8,  p: 1 }
const KEYLEN      = 64

async function hashPassword(password) {
  const params = DEV ? SCRYPT_DEV : SCRYPT_PROD
  const salt   = crypto.randomBytes(16).toString('hex')
  const key    = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { ...params, maxmem: 128 * params.N * params.r * 2 })
  return DEV ? `d$${salt}:${key.toString('hex')}` : `${salt}:${key.toString('hex')}`
}

async function verifyPassword({ hash, password }) {
  const isDev  = hash.startsWith('d$')
  const params = isDev ? SCRYPT_DEV : SCRYPT_PROD
  const raw    = isDev ? hash.slice(2) : hash
  const [salt, storedKey] = raw.split(':')
  if (!salt || !storedKey) return false
  const derived = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { ...params, maxmem: 128 * params.N * params.r * 2 })
  const a = derived
  const b = Buffer.from(storedKey, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Generate an Apple client secret JWT signed with the .p8 private key.
 * Valid for 6 months (Apple's maximum). Called once at startup.
 */
function generateAppleClientSecret() {
  const privateKey = process.env.APPLE_PRIVATE_KEY
  const keyId      = process.env.APPLE_KEY_ID
  const teamId     = process.env.APPLE_TEAM_ID
  const clientId   = process.env.APPLE_CLIENT_ID
  if (!privateKey || !keyId || !teamId || !clientId) return process.env.APPLE_CLIENT_SECRET ?? null

  const header  = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url')
  const now     = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: teamId,
    iat: now,
    exp: now + 15_777_000, // ~6 months
    aud: 'https://appleid.apple.com',
    sub: clientId,
  })).toString('base64url')

  const signingInput = `${header}.${payload}`
  const sign = crypto.createSign('SHA256')
  sign.update(signingInput)
  const sig = sign.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${signingInput}.${sig}`
}

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
    // Phase 0 (Intelligent Guide v1, §3.5.4): deferred verification. Signup
    // creates an authenticated session immediately so the new account can
    // explore the platform; tournament entry is the gated action and
    // enforces emailVerified at its own boundary. The amber EmailVerifyBanner
    // surfaces the prompt non-blockingly until they verify.
    requireEmailVerification: false,
    password: { hash: hashPassword, verify: verifyPassword },
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
    // Required when requireEmailVerification is false — otherwise no
    // verification email is sent at signup and the Resend banner button has
    // nothing to re-send.
    sendOnSignUp: true,
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
    // Spam guard: honeypot + timing check on email signup
    {
      id: 'spam-guard',
      async onRequest(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith('/sign-up/email') || req.method !== 'POST') return
        const hp  = req.headers.get('x-hp')
        const fst = req.headers.get('x-fst')
        // Filled honeypot → reject silently (generic message)
        if (hp) {
          return { response: new Response(JSON.stringify({ message: 'Sign up failed.' }), { status: 400, headers: { 'Content-Type': 'application/json' } }) }
        }
        // Submission faster than 3 s → reject
        if (fst) {
          const elapsed = Date.now() - Number(fst)
          if (elapsed < 3000) {
            return { response: new Response(JSON.stringify({ message: 'Please wait a moment before submitting.' }), { status: 400, headers: { 'Content-Type': 'application/json' } }) }
          }
        }
      },
    },
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
        clientSecret: generateAppleClientSecret(),
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
            const rawName = baUser.name?.trim()
            // Treat empty string or literal "Unknown" (betterAuth placeholder) as no name
            const resolvedName = (rawName && rawName.toLowerCase() !== 'unknown')
              ? rawName
              : baUser.email.split('@')[0]
            // New users always start with nameConfirmed=false. The /sync endpoint
            // (called by the frontend after login) flips it to true for email/credential
            // accounts once ba_accounts is guaranteed to exist. OAuth users get prompted.
            logger.info({ userId: baUser.id, baName: baUser.name, resolvedName }, 'Post-createUser sync')
            await syncUser({
              betterAuthId: baUser.id,
              email: baUser.email,
              username: resolvedName.toLowerCase().replace(/\s+/g, '_'),
              displayName: resolvedName,
              oauthProvider: 'email',
              avatarUrl: baUser.image || null,
              nameConfirmed: false,
            })
          } catch (err) {
            logger.warn({ err: err.message, userId: baUser.id }, 'Post-createUser domain upsert failed')
          }
        },
      },
    },
    session: {
      create: {
        // Reset lastActiveAt to now whenever a new session is created (sign-in).
        // Without this, `um list` and the idle-purge timer keep using the
        // user's pre-sign-in idle value until the next activityService flush
        // (up to 60s away) — making a freshly-signed-in user appear as e.g.
        // "17h idle" seconds after login.
        after: async (baSession) => {
          try {
            await db.user.updateMany({
              where: { betterAuthId: baSession.userId },
              data:  { lastActiveAt: baSession.createdAt ?? new Date() },
            })
          } catch (err) {
            logger.warn({ err: err.message, baUserId: baSession.userId }, 'Post-createSession lastActiveAt reset failed')
          }
        },
      },
    },
  },
})
