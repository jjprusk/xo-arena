/**
 * Auth middleware using Clerk.
 *
 * requireAuth      — rejects unauthenticated requests (401)
 * optionalAuth     — attaches user if token present, allows guests through
 * requireAdmin     — rejects non-admin users (403)
 */

import { createClerkClient, verifyToken as clerkVerifyToken } from '@clerk/backend'
import logger from '../logger.js'
import db from '../lib/db.js'

let clerkClient = null

function getClerk() {
  if (!clerkClient) {
    clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  }
  return clerkClient
}

/**
 * Extracts and verifies the Bearer token from the Authorization header.
 * Attaches `req.auth = { userId, sessionId }` on success.
 * Returns null (and sets nothing) if no token or invalid token.
 */
async function verifyToken(req) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null

  const token = header.slice(7)
  try {
    const payload = await clerkVerifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY })
    return { userId: payload.sub, sessionId: payload.sid }
  } catch (err) {
    logger.warn({ err: err.message }, 'JWT verification failed')
    return null
  }
}

/**
 * Middleware: requires a valid Clerk JWT.
 * Attaches req.auth = { userId, sessionId }
 * Also rejects requests from banned users (403).
 */
export async function requireAuth(req, res, next) {
  const auth = await verifyToken(req)
  if (!auth) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  req.auth = auth

  // Check banned flag
  try {
    const user = await db.user.findUnique({ where: { clerkId: auth.userId }, select: { banned: true } })
    if (user?.banned) return res.status(403).json({ error: 'Account suspended' })
  } catch (err) {
    logger.warn({ err }, 'Ban check failed — allowing request through')
  }

  next()
}

/**
 * Middleware: optional auth.
 * If a valid token is present, attaches req.auth. Otherwise req.auth = null (guest).
 */
export async function optionalAuth(req, _res, next) {
  req.auth = await verifyToken(req)
  next()
}

/**
 * Returns true if the given Clerk user ID has the admin role.
 * Safe to call without an active request/response — never throws.
 */
export async function isAdmin(userId) {
  try {
    const user = await getClerk().users.getUser(userId)
    return user.publicMetadata?.role === 'admin'
  } catch {
    return false
  }
}

/**
 * Middleware: requires auth AND admin role.
 * Must be chained after requireAuth.
 * Currently uses a Clerk public metadata check: { role: 'admin' }
 */
export async function requireAdmin(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' })

  try {
    const clerk = getClerk()
    const user = await clerk.users.getUser(req.auth.userId)
    if (user.publicMetadata?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }
    req.clerkUser = user
    next()
  } catch (err) {
    logger.error({ err }, 'Admin role check failed')
    res.status(500).json({ error: 'Authorization check failed' })
  }
}
