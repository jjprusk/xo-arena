import db from '../lib/db.js'
import { resolveUser, ok, fail } from '../lib/safety.js'

const VALID_ROLES = ['ADMIN', 'SUPPORT', 'BOT_ADMIN']

export function roleCommand(program) {
  program
    .command('role <username|email> <role>')
    .description(`Grant or revoke a role. Valid roles: ${VALID_ROLES.join(', ')}. Use --revoke to remove.`)
    .option('--revoke', 'Remove the role instead of adding it')
    .action(async (usernameOrEmail, role, opts) => {
      const normalised = role.toUpperCase()
      if (!VALID_ROLES.includes(normalised)) {
        fail(`invalid role "${role}". Valid roles: ${VALID_ROLES.join(', ')}`)
      }

      const user = await resolveUser(db, usernameOrEmail)

      if (opts.revoke) {
        const existing = user.userRoles.find(r => r.role === normalised)
        if (!existing) fail(`"${user.username}" does not have role ${normalised}`)
        await db.userRole.delete({ where: { id: existing.id } })
        ok(`Revoked ${normalised} from "${user.username}"`)
      } else {
        const already = user.userRoles.some(r => r.role === normalised)
        if (already) fail(`"${user.username}" already has role ${normalised}`)
        await db.userRole.create({ data: { userId: user.id, role: normalised, grantedById: user.id } })
        ok(`Granted ${normalised} to "${user.username}"`)
      }
    })
}
