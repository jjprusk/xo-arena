import db from '../lib/db.js'
import { resolveUsers, ok, fail } from '../lib/safety.js'
import Redis from 'ioredis'

function parseDuration(str) {
  if (str === '0') return 0
  const match = str.match(/^(\d+(?:\.\d+)?)(s|m|h)$/)
  if (!match) fail(`invalid duration "${str}" — use e.g. 90s, 10m, 2h, or 0`)
  const value = parseFloat(match[1])
  const unit  = match[2]
  return unit === 's' ? value * 1_000
       : unit === 'm' ? value * 60_000
       :                value * 3_600_000
}

export function formatIdle(lastActiveAt) {
  if (!lastActiveAt) return 'never'
  const ms = Date.now() - new Date(lastActiveAt).getTime()
  if (ms < 0)         return '0s'
  if (ms < 60_000)    return `${Math.floor(ms / 1_000)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

export function idleCommand(program) {
  program
    .command('idle <username|email|pattern> [duration]')
    .description('Show or set idle time. Without duration shows current idle time. With duration (e.g. 10m, 2h, 0) backdates lastActiveAt. Accepts a regex pattern to match multiple users.')
    .action(async (usernameOrEmail, duration) => {
      const users = await resolveUsers(db, usernameOrEmail)
      if (users.length === 0) fail(`no users found matching "${usernameOrEmail}"`)

      if (!duration) {
        for (const user of users) {
          console.log(`"${user.username}" idle: ${formatIdle(user.lastActiveAt)}`)
        }
        return
      }

      const ms  = parseDuration(duration)
      const ts  = new Date(Date.now() - ms)

      // Open Redis once for all users (if configured)
      let redis = null
      if (process.env.REDIS_URL) {
        redis = new Redis(process.env.REDIS_URL, { lazyConnect: true })
        try { await redis.connect() } catch { redis = null }
      }

      try {
        for (const user of users) {
          await db.user.update({
            where: { id: user.id },
            data:  { lastActiveAt: ts },
          })

          // Remove the Redis activity key so the 60s flush job doesn't overwrite
          // the value we just wrote with a newer cached timestamp.
          if (redis) {
            try { await redis.del(`user:active:${user.id}`) } catch { /* non-fatal */ }
          }

          if (ms === 0) {
            ok(`"${user.username}" lastActiveAt reset to now`)
          } else {
            ok(`"${user.username}" lastActiveAt set to ${ts.toISOString()} (${duration} ago)`)
          }
        }
      } finally {
        redis?.disconnect()
      }
    })
}
