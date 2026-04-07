/**
 * Auth middleware for the tournament service.
 *
 * requireAuth            — rejects unauthenticated requests (401)
 * requireTournamentAdmin — rejects users without TOURNAMENT_ADMIN or ADMIN role (403)
 *
 * Mirrors the pattern from backend/src/middleware/auth.js:
 * - Verifies Bearer JWT via JWKS table lookup (kid from JWT header)
 * - Uses jose (jwtVerify, importJWK)
 * - Returns { userId } (the Better Auth user ID, i.e. betterAuthId)
 */

import { jwtVerify, importJWK } from 'jose'
import db from '@xo-arena/db'
import logger from '../logger.js'

/**
 * Verifies a Better Auth JWT by looking up the signing key from the JWKS table.
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

  // Check banned flag
  try {
    const user = await db.user.findUnique({
      where: { betterAuthId: authPayload.userId },
      select: { id: true, banned: true },
    })
    if (user?.banned) return res.status(403).json({ error: 'Account suspended' })
  } catch (err) {
    logger.warn({ err }, 'Ban check failed — allowing request through')
  }

  next()
}

/**
 * Returns true if the given Better Auth user ID has TOURNAMENT_ADMIN or ADMIN role.
 * Checks both the BA role field and the domain UserRole table.
 * Never throws.
 */
export async function isTournamentAdmin(userId) {
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
 * Middleware: requires auth AND tournament (or admin) role.
 * Must be used after requireAuth (or standalone — it handles 401 too).
 */
export async function requireTournamentAdmin(req, res, next) {
  if (!req.auth) {
    const authPayload = await verifyToken(req)
    if (!authPayload) {
      return res.status(401).json({ error: 'Authentication required' })
    }
    req.auth = authPayload
  }

  try {
    const ok = await isTournamentAdmin(req.auth.userId)
    if (!ok) {
      return res.status(403).json({ error: 'Tournament admin access required' })
    }
    next()
  } catch (err) {
    logger.error({ err }, 'Tournament admin role check failed')
    res.status(500).json({ error: 'Authorization check failed' })
  }
}
