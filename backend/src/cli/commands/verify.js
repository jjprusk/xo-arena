import db from '../lib/db.js'
import { resolveUsers, ok, fail } from '../lib/safety.js'

export function verifyCommand(program) {
  program
    .command('verify <username|email|pattern>')
    .description('Set email verification state (verified by default). Accepts a regex pattern to match multiple users.')
    .option('--noverify', 'Mark as unverified instead')
    .action(async (usernameOrEmail, opts) => {
      const users = await resolveUsers(db, usernameOrEmail)
      if (users.length === 0) fail(`no users found matching "${usernameOrEmail}"`)

      const verified = !opts.noverify
      for (const user of users) {
        if (!user.betterAuthId) {
          console.error(`  ✗ "${user.username}" skipped — no BetterAuth account`)
          continue
        }
        await db.baUser.update({
          where: { id: user.betterAuthId },
          data:  { emailVerified: verified },
        })
        ok(`"${user.username}" marked as ${verified ? 'verified' : 'unverified'}`)
      }
    })
}
