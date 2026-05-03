// Copyright © 2026 Joe Pruskowski. All rights reserved.
import db from '../lib/db.js'
import { resolveUsers, ok, fail } from '../lib/safety.js'
import Redis from 'ioredis'

export function sessionCommand(program) {
  program
    .command('session <username|email|pattern>')
    .description('Invalidate all sessions for a user. Accepts a regex pattern to match multiple users.')
    .requiredOption('--invalidate', 'Required: confirm you want to invalidate sessions')
    .action(async (usernameOrEmail) => {
      const users = await resolveUsers(db, usernameOrEmail)
      if (users.length === 0) fail(`no users found matching "${usernameOrEmail}"`)

      // Open Redis once for all users (if configured)
      let redis = null
      if (process.env.REDIS_URL) {
        redis = new Redis(process.env.REDIS_URL, { lazyConnect: true })
        try { await redis.connect() } catch { redis = null }
      }

      try {
        for (const user of users) {
          if (!user.betterAuthId) {
            console.error(`  ✗ "${user.username}" skipped — no BetterAuth account`)
            continue
          }

          const { count } = await db.baSession.deleteMany({
            where: { userId: user.betterAuthId },
          })

          // Clear Redis activity key so the flush job stops updating lastActiveAt
          if (redis) {
            try { await redis.del(`user:active:${user.id}`) } catch { /* non-fatal */ }
          }

          ok(`Invalidated ${count} session(s) for "${user.username}"`)
        }
      } finally {
        redis?.disconnect()
      }
    })
}
