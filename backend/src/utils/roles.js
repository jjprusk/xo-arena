/**
 * Role resolution utilities.
 *
 * User objects passed here must include a `userRoles` array (from Prisma select).
 * ADMIN implicitly satisfies any role check.
 */

export const VALID_ROLES = ['ADMIN', 'BOT_ADMIN', 'TOURNAMENT_ADMIN']

/**
 * Returns true if the user holds the given role.
 * ADMIN implicitly satisfies any role check.
 *
 * @param {{ userRoles: Array<{ role: string }> } | null | undefined} user
 * @param {string} role
 */
export function hasRole(user, role) {
  if (!user?.userRoles) return false
  const roles = user.userRoles.map(r => r.role)
  return roles.includes('ADMIN') || roles.includes(role)
}

/**
 * Returns the set of role strings held by the user.
 * @param {{ userRoles: Array<{ role: string }> } | null | undefined} user
 */
export function getRoles(user) {
  return user?.userRoles?.map(r => r.role) ?? []
}
