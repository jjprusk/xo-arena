/**
 * RBAC middleware factory.
 *
 * Usage:
 *   router.post('/some-route', requireAuth, requireRole('TOURNAMENT_ADMIN', 'ADMIN'), handler)
 *
 * Checks the domain UserRole table and BA user role field.
 * Must be used AFTER requireAuth (req.auth must be set).
 */

import db from '@xo-arena/db'
import logger from '../logger.js'

/**
 * Returns a middleware that requires the authenticated user to have at least
 * one of the specified roles (or be a BA-level admin).
 *
 * @param {...string} roles - Role names to check (e.g. 'TOURNAMENT_ADMIN', 'ADMIN')
 */
export function requireRole(...roles) {
  return async function (req, res, next) {
    if (!req.auth) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    try {
      const [baUser, domainUser] = await Promise.all([
        db.baUser.findUnique({
          where: { id: req.auth.userId },
          select: { role: true },
        }),
        db.user.findUnique({
          where: { betterAuthId: req.auth.userId },
          select: { userRoles: { select: { role: true } } },
        }),
      ])

      const userRoles = domainUser?.userRoles?.map(r => r.role) ?? []
      const isBaAdmin = baUser?.role === 'admin'
      const hasRole = isBaAdmin || roles.some(r => userRoles.includes(r))

      if (!hasRole) {
        return res.status(403).json({ error: 'Insufficient permissions' })
      }

      next()
    } catch (err) {
      logger.error({ err }, 'Role check failed')
      res.status(500).json({ error: 'Authorization check failed' })
    }
  }
}
