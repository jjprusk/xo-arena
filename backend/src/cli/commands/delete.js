import { createInterface } from 'readline'
import db from '../lib/db.js'
import { resolveUser, ok, fail } from '../lib/safety.js'

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(`${question} [y/N] `, answer => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}

export function deleteCommand(program) {
  program
    .command('delete <username|email>')
    .description('Hard-delete a user and all related data')
    .option('--yes', 'Skip confirmation prompt')
    .option('--force', 'Allow deletion of admin accounts')
    .action(async (usernameOrEmail, opts) => {
      const user = await resolveUser(db, usernameOrEmail)

      const isAdmin = user.userRoles.some(r => r.role === 'ADMIN')

      if (isAdmin && !opts.force) {
        fail(`"${user.username}" is an admin — pass --force to delete an admin account`)
      }

      if (isAdmin && opts.force) {
        // Refuse if last admin
        const adminCount = await db.userRole.count({ where: { role: 'ADMIN' } })
        if (adminCount <= 1) {
          fail('Cannot delete the last admin account — there must always be at least one admin')
        }
      }

      if (!opts.yes) {
        const confirmed = await confirm(`Delete user "${user.username}" (${user.email})? This cannot be undone.`)
        if (!confirmed) {
          console.log('Aborted.')
          process.exit(0)
        }
      }

      // Delete app user (cascades via DB constraints where possible)
      await db.$transaction(async (tx) => {
        // BetterAuth rows cascade from BaUser via onDelete: Cascade
        if (user.betterAuthId) {
          await tx.baUser.delete({ where: { id: user.betterAuthId } })
        }
        await tx.user.delete({ where: { id: user.id } })
      })

      ok(`Deleted user "${user.username}"`)
    })
}
