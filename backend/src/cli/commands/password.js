import { hashPassword } from 'better-auth/crypto'
import db from '../lib/db.js'
import { resolveUser, ok, fail } from '../lib/safety.js'

export function passwordCommand(program) {
  program
    .command('password <username|email> <new-password>')
    .description("Reset a user's password")
    .action(async (usernameOrEmail, newPassword) => {
      const user = await resolveUser(db, usernameOrEmail)
      if (!user.betterAuthId) fail(`user "${usernameOrEmail}" has no BetterAuth account`)

      const account = await db.baAccount.findFirst({
        where: { userId: user.betterAuthId, providerId: 'credential' },
      })
      if (!account) fail(`user "${usernameOrEmail}" has no credential account (OAuth-only?)`)

      const hashed = await hashPassword(newPassword)
      await db.baAccount.update({
        where: { id: account.id },
        data:  { password: hashed },
      })

      ok(`Password updated for "${user.username}"`)
    })
}
