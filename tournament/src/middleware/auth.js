import { jwtVerify, importJWK } from 'jose'
import db from '../lib/db.js'
import logger from '../logger.js'

async function verifyToken(req) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice(7)
  try {
    const [rawHeader] = token.split('.')
    const { kid } = JSON.parse(Buffer.from(rawHeader, 'base64url').toString())
    if (!kid) return null
    const jwk = await db.jwks.findUnique({ where: { id: kid } })
    if (!jwk) return null
    const cryptoKey = await importJWK(JSON.parse(jwk.publicKey), 'EdDSA')
    const { payload } = await jwtVerify(token, cryptoKey)
    if (!payload?.sub) return null
    return { userId: payload.sub }
  } catch (err) {
    logger.warn({ err: err.message }, 'JWT verification failed')
    return null
  }
}

export async function requireAuth(req, res, next) {
  const authPayload = await verifyToken(req)
  if (!authPayload) return res.status(401).json({ error: 'Unauthorized' })
  const user = await db.user.findUnique({
    where: { betterAuthId: authPayload.userId },
    select: { id: true, banned: true },
  })
  if (user?.banned) return res.status(403).json({ error: 'Account suspended' })
  req.auth = { ...authPayload, dbUserId: user?.id }
  next()
}

export async function optionalAuth(req, res, next) {
  const authPayload = await verifyToken(req)
  if (!authPayload) {
    req.auth = null
    return next()
  }
  const user = await db.user.findUnique({
    where: { betterAuthId: authPayload.userId },
    select: { id: true, banned: true },
  })
  req.auth = { ...authPayload, dbUserId: user?.id }
  next()
}

export async function isAdmin(userId) {
  const baUser = await db.baUser.findUnique({
    where: { id: userId },
    select: { role: true },
  })
  if (baUser?.role === 'admin') return true
  const appUser = await db.user.findUnique({
    where: { betterAuthId: userId },
    select: { userRoles: { select: { role: true } } },
  })
  return appUser?.userRoles?.some(r => r.role === 'ADMIN') ?? false
}

export async function isTournamentAdmin(userId) {
  if (await isAdmin(userId)) return true
  const appUser = await db.user.findUnique({
    where: { betterAuthId: userId },
    select: { userRoles: { select: { role: true } } },
  })
  return appUser?.userRoles?.some(r => r.role === 'TOURNAMENT_ADMIN') ?? false
}

export async function requireAdmin(req, res, next) {
  await requireAuth(req, res, async () => {
    const ok = await isAdmin(req.auth.userId)
    if (!ok) return res.status(403).json({ error: 'Forbidden' })
    next()
  })
}

export async function requireTournamentAdmin(req, res, next) {
  await requireAuth(req, res, async () => {
    const ok = await isTournamentAdmin(req.auth.userId)
    if (!ok) return res.status(403).json({ error: 'Forbidden' })
    next()
  })
}
