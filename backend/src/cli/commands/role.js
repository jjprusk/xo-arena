// Copyright © 2026 Joe Pruskowski. All rights reserved.
import db from '../lib/db.js'
import { resolveUsers, ok, fail } from '../lib/safety.js'

const VALID_ROLES = ['ADMIN', 'SUPPORT', 'BOT_ADMIN']

export function roleCommand(program) {
  program
    .command('role <username|email|pattern> <role>')
    .description(`Grant or revoke a role. Valid roles: ${VALID_ROLES.join(', ')}. Use --revoke to remove. Accepts a regex pattern to match multiple users.`)
    .option('--revoke', 'Remove the role instead of adding it')
    .action(async (usernameOrEmail, role, opts) => {
      const normalised = role.toUpperCase()
      if (!VALID_ROLES.includes(normalised)) {
        fail(`invalid role "${role}". Valid roles: ${VALID_ROLES.join(', ')}`)
      }

      const users = await resolveUsers(db, usernameOrEmail)
      if (users.length === 0) fail(`no users found matching "${usernameOrEmail}"`)

      for (const user of users) {
        if (opts.revoke) {
          const existing = user.userRoles.find(r => r.role === normalised)
          if (!existing) {
            console.log(`  — "${user.username}" does not have ${normalised}, skipped`)
            continue
          }
          await db.userRole.delete({ where: { id: existing.id } })
          ok(`Revoked ${normalised} from "${user.username}"`)
        } else {
          const already = user.userRoles.some(r => r.role === normalised)
          if (already) {
            console.log(`  — "${user.username}" already has ${normalised}, skipped`)
            continue
          }
          await db.userRole.create({ data: { userId: user.id, role: normalised, grantedById: user.id } })
          ok(`Granted ${normalised} to "${user.username}"`)
        }
      }
    })
}
