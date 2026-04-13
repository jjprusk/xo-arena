// Copyright © 2026 Joe Pruskowski. All rights reserved.
import db from '../lib/db.js'
import { resolveUsers, fail } from '../lib/safety.js'

export function statusCommand(program) {
  program
    .command('status <username|email|pattern>')
    .description('Show active sessions for a user. Accepts a regex pattern to match multiple users.')
    .action(async (usernameOrEmail) => {
      const users = await resolveUsers(db, usernameOrEmail)
      if (users.length === 0) fail(`no users found matching "${usernameOrEmail}"`)

      for (const user of users) {
        if (!user.betterAuthId) {
          console.log(`○ "${user.username}" has no BetterAuth account`)
          continue
        }

        const sessions = await db.baSession.findMany({
          where: {
            userId:    user.betterAuthId,
            expiresAt: { gt: new Date() },
          },
          orderBy: { expiresAt: 'desc' },
        })

        if (sessions.length === 0) {
          console.log(`○ "${user.username}" has no active sessions`)
        } else {
          const s = sessions.length === 1 ? 'session' : 'sessions'
          console.log(`● "${user.username}" has ${sessions.length} active ${s}`)
          for (const session of sessions) {
            const expires = session.expiresAt.toISOString().slice(0, 16).replace('T', ' ')
            const ua = session.userAgent
              ? `  ${session.userAgent.slice(0, 60)}`
              : ''
            console.log(`  expires ${expires}${ua}`)
          }
        }
      }
    })
}
