import db from '../lib/db.js'
import { formatIdle } from './idle.js'

export function listCommand(program) {
  program
    .command('list [username|email]')
    .description('List users (pass a username or email to show a single user). IDLE reflects the last Postgres flush — may lag up to 60s behind real activity.')
    .option('--limit <n>', 'Max rows to show', '20')
    .option('--unverified', 'Show only unverified accounts')
    .action(async (usernameOrEmail, opts) => {
      const limit = parseInt(opts.limit, 10)

      const singleFilter = usernameOrEmail
        ? usernameOrEmail.includes('@')
          ? { email: usernameOrEmail }
          : { username: usernameOrEmail }
        : undefined

      const users = await db.user.findMany({
        where:   { isBot: false, ...singleFilter },
        take:    singleFilter ? undefined : limit,
        orderBy: { createdAt: 'desc' },
        include: { userRoles: true },
      })

      // Fetch verification status and active sessions from BetterAuth
      const baIds = users.map(u => u.betterAuthId).filter(Boolean)
      const [baUsers, activeSessions] = await Promise.all([
        baIds.length
          ? db.baUser.findMany({ where: { id: { in: baIds } }, select: { id: true, emailVerified: true } })
          : [],
        baIds.length
          ? db.baSession.findMany({
              where: { userId: { in: baIds }, expiresAt: { gt: new Date() } },
              select: { userId: true },
            })
          : [],
      ])
      const baMap      = Object.fromEntries(baUsers.map(u => [u.id, u]))
      const onlineSet  = new Set(activeSessions.map(s => s.userId))

      const rows = users
        .map(u => ({
          ...u,
          emailVerified: baMap[u.betterAuthId]?.emailVerified ?? null,
          online:        u.betterAuthId ? onlineSet.has(u.betterAuthId) : false,
        }))
        .filter(u => !opts.unverified || !u.emailVerified)

      if (rows.length === 0) {
        console.log('No users found.')
        process.exit(0)
      }

      // Column widths
      const col = (val, w) => String(val ?? '').padEnd(w).slice(0, w)

      const header = [
        col('',          2),
        col('USERNAME',  16),
        col('EMAIL',     26),
        col('VERIFIED',  8),
        col('IDLE',      7),
        col('HINTS',     6),
        col('ROLES',     20),
        col('CREATED',   12),
      ].join('  ')

      const divider = '-'.repeat(header.length)
      console.log(header)
      console.log(divider)

      for (const u of rows) {
        const roles    = u.userRoles.map(r => r.role).join(', ') || '—'
        const created  = u.createdAt.toISOString().slice(0, 10)
        const verified = u.emailVerified == null ? '?' : u.emailVerified ? 'yes' : 'no'
        const dot      = u.online ? '●' : '○'
        const prefs    = (u.preferences && typeof u.preferences === 'object') ? u.preferences : {}
        const hints    = prefs.faqHintSeen ? 'seen' : 'new'
        console.log([
          col(dot,                        2),
          col(u.username,                16),
          col(u.email,                   26),
          col(verified,                   8),
          col(formatIdle(u.lastActiveAt), 7),
          col(hints,                      6),
          col(roles,                     20),
          col(created,                   12),
        ].join('  '))
      }

      console.log(divider)
      console.log(`${rows.length} user(s)`)
    })
}
