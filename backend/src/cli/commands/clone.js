// Copyright © 2026 Joe Pruskowski. All rights reserved.
import db from '../lib/db.js'
import { resolveUser, ok, fail } from '../lib/safety.js'
import { createUser } from './create.js'

export function cloneCommand(program) {
  program
    .command('clone <username> <n>')
    .description('Clone an existing user n times, creating <username>0, <username>1, … Each clone uses its own name as password and inherits the original\'s verified status and roles.')
    .action(async (username, nArg) => {
      const n = parseInt(nArg, 10)
      if (isNaN(n) || n < 1) fail('<n> must be a positive integer')

      const original = await resolveUser(db, username)

      // Determine verified status from BetterAuth
      const baUser = original.betterAuthId
        ? await db.baUser.findUnique({ where: { id: original.betterAuthId }, select: { emailVerified: true } })
        : null
      const verified = baUser?.emailVerified ?? true

      // Collect roles from original
      const roles = original.userRoles.map(r => r.role)

      let created = 0
      for (let i = 0; i < n; i++) {
        const cname = `${username}${i}`
        try {
          await createUser({
            username:    cname,
            email:       `${cname}@dev.local`,
            displayName: cname,
            password:    cname,
            verified,
            roles,
          })
          ok(`"${cname}" (password: ${cname})`)
          created++
        } catch (err) {
          console.error(`  ✗ "${cname}" skipped — ${err.message}`)
        }
      }
      console.log(`${created} of ${n} clone(s) created from "${username}".`)
    })
}
