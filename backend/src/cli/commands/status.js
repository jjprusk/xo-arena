import db from '../lib/db.js'
import { resolveUser, fail } from '../lib/safety.js'

export function statusCommand(program) {
  program
    .command('status <username|email>')
    .description('Show active sessions for a user')
    .action(async (usernameOrEmail) => {
      const user = await resolveUser(db, usernameOrEmail)
      if (!user.betterAuthId) fail(`user "${usernameOrEmail}" has no BetterAuth account`)

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
    })
}
