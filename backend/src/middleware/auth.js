/**
 * Auth middleware using Better Auth.
 *
 * requireAuth      — rejects unauthenticated requests (401)
 * optionalAuth     — attaches user if token present, allows guests through
 * requireAdmin     — rejects non-admin users (403)
 * isAdmin          — helper; returns boolean
 */

import { auth } from '../lib/auth.js'
import logger from '../logger.js'
import db from '../lib/db.js'

/**
 * Extracts and verifies the Bearer JWT from the Authorization header via
 * the Better Auth JWT plugin's verifyJWT endpoint.
 *
 * Returns { userId } on success, or null if the token is absent/invalid.
 */
async function verifyToken(req) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null

  const token = header.slice(7)
  try {
    // Better Auth JWT plugin: auth.api.verifyJWT({ body: { token } })
    // Returns { payload } where payload.sub is the BA user ID
    const result = await auth.api.verifyJWT({ body: { token } })
    if (!result?.payload?.sub) return null
    return { userId: result.payload.sub }
  } catch (err) {
    logger.warn({ err: err.message }, 'JWT verification failed')
    return null
  }
}

/**
 * Middleware: requires a valid Better Auth JWT.
 * Attaches req.auth = { userId }
 * Also rejects requests from banned users (403).
 */
export async function requireAuth(req, res, next) {
  const authPayload = await verifyToken(req)
  if (!authPayload) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  req.auth = authPayload

  // Check banned flag via betterAuthId on domain User
  try {
    const user = await db.user.findUnique({
      where: { betterAuthId: authPayload.userId },
      select: { banned: true },
    })
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
 * Returns true if the given Better Auth user ID has the admin role.
 * Safe to call without an active request/response — never throws.
 */
export async function isAdmin(userId) {
  try {
    const baUser = await db.baUser.findUnique({
      where: { id: userId },
      select: { role: true },
    })
    return baUser?.role === 'admin'
  } catch {
    return false
  }
}

/**
 * Middleware: requires auth AND admin role.
 * Must be chained after requireAuth (or used standalone — it handles 401 too).
 */
export async function requireAdmin(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' })

  try {
    const adminUser = await isAdmin(req.auth.userId)
    if (!adminUser) {
      return res.status(403).json({ error: 'Admin access required' })
    }
    next()
  } catch (err) {
    logger.error({ err }, 'Admin role check failed')
    res.status(500).json({ error: 'Authorization check failed' })
  }
}
