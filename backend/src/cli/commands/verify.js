import db from '../lib/db.js'
import { resolveUser, ok, fail } from '../lib/safety.js'

export function verifyCommand(program) {
  program
    .command('verify <username|email>')
    .description('Set email verification state (verified by default)')
    .option('--noverify', 'Mark as unverified instead')
    .action(async (usernameOrEmail, opts) => {
      const user = await resolveUser(db, usernameOrEmail)
      if (!user.betterAuthId) fail(`user "${usernameOrEmail}" has no BetterAuth account`)

      const verified = !opts.noverify
      await db.baUser.update({
        where: { id: user.betterAuthId },
        data:  { emailVerified: verified },
      })

      ok(`"${user.username}" marked as ${verified ? 'verified' : 'unverified'}`)
    })
}
