// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { createInterface } from 'readline'
import db from '../lib/db.js'
import { resolveUsers, ok, fail } from '../lib/safety.js'
import {
  findOwnedBots,
  deleteUserWithBots,
  BuiltinBotProtectedError,
} from '../../services/userDeletionService.js'

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
    .command('delete <username|email|pattern>')
    .description('Hard-delete a user and all related data. Accepts a regex pattern to match multiple users.')
    .option('--yes', 'Skip confirmation prompt')
    .option('--force', 'Allow deletion of admin accounts')
    .action(async (usernameOrEmail, opts) => {
      const allUsers = await resolveUsers(db, usernameOrEmail)
      if (allUsers.length === 0) fail(`no users found matching "${usernameOrEmail}"`)

      // Separate admins from non-admins; block admins without --force
      const adminCount = await db.userRole.count({ where: { role: 'ADMIN' } })
      let remainingAdmins = adminCount

      const toDelete = []
      for (const user of allUsers) {
        const isAdmin = user.userRoles.some(r => r.role === 'ADMIN')
        if (isAdmin && !opts.force) {
          console.error(`  ✗ "${user.username}" is an admin — pass --force to include admin accounts`)
          continue
        }
        if (isAdmin && remainingAdmins <= 1) {
          console.error(`  ✗ "${user.username}" skipped — cannot delete the last admin account`)
          continue
        }
        if (isAdmin) remainingAdmins--

        const bots = await findOwnedBots(db, user.id)
        toDelete.push({ ...user, _bots: bots })
      }

      if (toDelete.length === 0) {
        console.log('Nothing to delete.')
        process.exit(0)
      }

      if (!opts.yes) {
        if (toDelete.length === 1) {
          const u = toDelete[0]
          const botSuffix = u._bots.length > 0
            ? ` and ${u._bots.length} bot${u._bots.length === 1 ? '' : 's'} (${u._bots.map(b => b.username).join(', ')})`
            : ''
          const confirmed = await confirm(`Delete user "${u.username}" (${u.email})${botSuffix}? This cannot be undone.`)
          if (!confirmed) { console.log('Aborted.'); process.exit(0) }
        } else {
          console.log(`About to delete ${toDelete.length} users:`)
          for (const u of toDelete) {
            const botSuffix = u._bots.length > 0 ? ` [+${u._bots.length} bot${u._bots.length === 1 ? '' : 's'}]` : ''
            console.log(`  ${u.username} (${u.email})${botSuffix}`)
          }
          const confirmed = await confirm('Delete all of the above? This cannot be undone.')
          if (!confirmed) { console.log('Aborted.'); process.exit(0) }
        }
      }

      for (const user of toDelete) {
        try {
          await deleteUserWithBots(db, user, user._bots)
        } catch (err) {
          if (err instanceof BuiltinBotProtectedError) {
            console.error(`  ✗ "${user.username}" skipped — ${err.message}`)
            continue
          }
          throw err
        }
        const botSuffix = user._bots.length > 0 ? ` (+${user._bots.length} bot${user._bots.length === 1 ? '' : 's'})` : ''
        ok(`Deleted user "${user.username}"${botSuffix}`)
      }
    })
}
