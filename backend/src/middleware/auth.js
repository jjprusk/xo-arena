// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Auth middleware using Better Auth.
 *
 * requireAuth      — rejects unauthenticated requests (401)
 * optionalAuth     — attaches user if token present, allows guests through
 * requireAdmin     — rejects non-admin users (403)
 * isAdmin          — helper; returns boolean
 */

import logger from '../logger.js'
import db from '../lib/db.js'
import { jwtVerify, importJWK } from 'jose'
import { recordActivity } from '../services/activityService.js'

/**
 * Verifies a Better Auth JWT by looking up the signing key from the JWKS table.
 * Mirrors what Better Auth's verifyJWT plugin does internally.
 *
 * Returns { userId } on success, or null if absent/invalid.
 */
async function verifyToken(req) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice(7)

  try {
    // Parse kid from JWT header to find the right key
    const [rawHeader] = token.split('.')
    const { kid } = JSON.parse(Buffer.from(rawHeader, 'base64url').toString())
    if (!kid) return null

    const jwk = await db.jwks.findUnique({ where: { id: kid } })
    if (!jwk) return null

    const cryptoKey = await importJWK(JSON.parse(jwk.publicKey), 'EdDSA')
    // No issuer/audience check — BA's JWT plugin doesn't set those claims;
    // verifying against the correct public key from the DB is sufficient.
    const { payload } = await jwtVerify(token, cryptoKey)

    if (!payload?.sub) return null
    return { userId: payload.sub }
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

  // Check banned flag and active session in parallel.
  // Activity is only recorded when a real BaSession exists — this prevents
  // a cached-but-still-valid JWT from updating lastActiveAt after sign-out.
  try {
    const [user, activeSession] = await Promise.all([
      db.user.findUnique({
        where: { betterAuthId: authPayload.userId },
        select: { id: true, banned: true },
      }),
      db.baSession.findFirst({
        where: { userId: authPayload.userId, expiresAt: { gt: new Date() } },
        select: { id: true },
      }),
    ])
    if (user?.banned) return res.status(403).json({ error: 'Account suspended' })
    if (user?.id && activeSession) recordActivity(user.id)
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
 * Checks both the BA role field (for BA-level admin) and the domain UserRole table.
 * Safe to call without an active request/response — never throws.
 */
export async function isAdmin(userId) {
  try {
    const [baUser, domainUser] = await Promise.all([
      db.baUser.findUnique({ where: { id: userId }, select: { role: true } }),
      db.user.findUnique({
        where: { betterAuthId: userId },
        select: { userRoles: { select: { role: true } } },
      }),
    ])
    return (
      baUser?.role === 'admin' ||
      domainUser?.userRoles?.some(r => r.role === 'ADMIN') === true
    )
  } catch {
    return false
  }
}

/**
 * Returns true if the given Better Auth user ID has the TOURNAMENT_ADMIN role (or ADMIN).
 * Safe to call without an active request/response — never throws.
 */
export async function isTournament(userId) {
  try {
    const [baUser, domainUser] = await Promise.all([
      db.baUser.findUnique({ where: { id: userId }, select: { role: true } }),
      db.user.findUnique({
        where: { betterAuthId: userId },
        select: { userRoles: { select: { role: true } } },
      }),
    ])
    const roles = domainUser?.userRoles?.map(r => r.role) ?? []
    return (
      baUser?.role === 'admin' ||
      roles.includes('ADMIN') ||
      roles.includes('TOURNAMENT_ADMIN')
    )
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

/**
 * Middleware: requires auth AND tournament (or admin) role.
 */
export async function requireTournament(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' })

  try {
    const ok = await isTournament(req.auth.userId)
    if (!ok) {
      return res.status(403).json({ error: 'Tournament access required' })
    }
    next()
  } catch (err) {
    logger.error({ err }, 'Tournament role check failed')
    res.status(500).json({ error: 'Authorization check failed' })
  }
}

/**
 * Returns true if the given Better Auth user ID has the SUPPORT role (or ADMIN).
 * Safe to call without an active request/response — never throws.
 */
export async function isSupport(userId) {
  try {
    const [baUser, domainUser] = await Promise.all([
      db.baUser.findUnique({ where: { id: userId }, select: { role: true } }),
      db.user.findUnique({
        where: { betterAuthId: userId },
        select: { userRoles: { select: { role: true } } },
      }),
    ])
    const roles = domainUser?.userRoles?.map(r => r.role) ?? []
    return (
      baUser?.role === 'admin' ||
      roles.includes('ADMIN') ||
      roles.includes('SUPPORT')
    )
  } catch {
    return false
  }
}

/**
 * Middleware: requires auth AND support (or admin) role.
 */
export async function requireSupport(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' })

  try {
    const ok = await isSupport(req.auth.userId)
    if (!ok) {
      return res.status(403).json({ error: 'Support access required' })
    }
    next()
  } catch (err) {
    logger.error({ err }, 'Support role check failed')
    res.status(500).json({ error: 'Authorization check failed' })
  }
}
