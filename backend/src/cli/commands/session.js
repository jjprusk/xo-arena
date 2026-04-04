import db from '../lib/db.js'
import { resolveUser, ok, fail } from '../lib/safety.js'

export function sessionCommand(program) {
  program
    .command('session <username|email>')
    .description('Invalidate all sessions for a user')
    .requiredOption('--invalidate', 'Required: confirm you want to invalidate sessions')
    .action(async (usernameOrEmail) => {
      const user = await resolveUser(db, usernameOrEmail)
      if (!user.betterAuthId) fail(`user "${usernameOrEmail}" has no BetterAuth account`)

      const { count } = await db.baSession.deleteMany({
        where: { userId: user.betterAuthId },
      })

      ok(`Invalidated ${count} session(s) for "${user.username}"`)
    })
}
