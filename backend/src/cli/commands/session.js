import db from '../lib/db.js'
import { resolveUser, ok, fail } from '../lib/safety.js'
import Redis from 'ioredis'

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

      // Also clear the Redis activity key so the flush job stops updating
      // lastActiveAt for this user after their sessions are gone.
      if (process.env.REDIS_URL) {
        const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true })
        try {
          await redis.connect()
          await redis.del(`user:active:${user.id}`)
        } catch {
          // Non-fatal
        } finally {
          redis.disconnect()
        }
      }

      ok(`Invalidated ${count} session(s) for "${user.username}"`)
    })
}
