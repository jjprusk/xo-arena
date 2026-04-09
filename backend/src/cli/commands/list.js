import db from '../lib/db.js'
import { formatIdle } from './idle.js'

const GREEN  = '\x1b[32m'
const YELLOW = '\x1b[93m'
const RED    = '\x1b[31m'
const TEAL   = '\x1b[36m'
const DIM    = '\x1b[2m'
const RESET  = '\x1b[0m'

// uiHints keys shown in the HINTS column, in display order
const HINT_COLS = [
  { key: 'faqTipShown',     symbol: 't' },
  { key: 'faqPointerShown', symbol: 'p' },
]

function formatHints(uiHints) {
  const bits = HINT_COLS.map(({ key, symbol }) =>
    uiHints?.[key] ? `${TEAL}${symbol}${RESET}` : `${DIM}${symbol}${RESET}`
  ).join('')
  return `[${bits}]`
}

async function getIdleConfig() {
  const [warnRow, graceRow] = await Promise.all([
    db.systemConfig.findUnique({ where: { key: 'session.idleWarnMinutes' } }),
    db.systemConfig.findUnique({ where: { key: 'session.idleGraceMinutes' } }),
  ])
  return {
    warnMs:  ((warnRow?.value  ?? 30) * 60_000),
    graceMs: ((graceRow?.value ??  5) * 60_000),
  }
}

export function listCommand(program) {
  program
    .command('list [username|email|pattern]')
    .description('List users. Pass a username/email for exact match or a regex pattern (quoted) to filter. IDLE reflects the last Postgres flush — may lag up to 60s behind real activity.')
    .option('--limit <n>', 'Max rows to show', '20')
    .option('--unverified', 'Show only unverified accounts')
    .action(async (usernameOrEmail, opts) => {
      const limit = parseInt(opts.limit, 10)

      // Resolve filter: exact email, exact username, regex, or none (all users)
      let userFilter = null  // null = fetch all, then optionally apply regex
      let regexFilter = null

      if (usernameOrEmail) {
        if (usernameOrEmail.includes('@')) {
          userFilter = { isBot: false, email: usernameOrEmail }
        } else if (/[.*+?^${}()|[\]\\]/.test(usernameOrEmail)) {
          // Regex pattern — fetch all and filter in JS
          try { regexFilter = new RegExp(usernameOrEmail, 'i') } catch {
            console.error(`um: invalid regex: ${usernameOrEmail}`)
            process.exit(1)
          }
          userFilter = { isBot: false }
        } else {
          userFilter = { isBot: false, username: usernameOrEmail }
        }
      } else {
        userFilter = { isBot: false }
      }

      const [allUsers, { warnMs, graceMs }] = await Promise.all([
        db.user.findMany({
          where:   userFilter,
          take:    regexFilter || !usernameOrEmail ? limit : undefined,
          orderBy: { createdAt: 'desc' },
          include: { userRoles: true },
        }),
        getIdleConfig(),
      ])

      const users = regexFilter
        ? allUsers.filter(u => regexFilter.test(u.username))
        : allUsers

      // Fetch verification status and active sessions from BetterAuth
      const baIds = users.map(u => u.betterAuthId).filter(Boolean)
      const [baUsers, activeSessions] = await Promise.all([
        baIds.length
          ? db.baUser.findMany({ where: { id: { in: baIds } }, select: { id: true, emailVerified: true } })
          : [],
        baIds.length
          ? db.baSession.findMany({
              where: { userId: { in: baIds }, expiresAt: { gt: new Date() } },
              select: { userId: true, createdAt: true },
            })
          : [],
      ])
      const baMap      = Object.fromEntries(baUsers.map(u => [u.id, u]))
      const onlineSet  = new Set(activeSessions.map(s => s.userId))
      // Most recent sign-in per user (latest session createdAt)
      const signInMap  = {}
      for (const s of activeSessions) {
        if (!signInMap[s.userId] || s.createdAt > signInMap[s.userId]) {
          signInMap[s.userId] = s.createdAt
        }
      }

      const rows = users
        .map(u => ({
          ...u,
          emailVerified: baMap[u.betterAuthId]?.emailVerified ?? null,
          online:        u.betterAuthId ? onlineSet.has(u.betterAuthId) : false,
          signedInAt:    u.betterAuthId ? (signInMap[u.betterAuthId] ?? null) : null,
        }))
        .filter(u => !opts.unverified || !u.emailVerified)

      if (rows.length === 0) {
        console.log('No users found.')
        process.exit(0)
      }

      // Column widths — col() pads the plain string; colour codes are added after
      const col = (val, w) => String(val ?? '').padEnd(w).slice(0, w)

      const header = [
        col('',          2),
        col('USERNAME',  16),
        col('EMAIL',     26),
        col('VERIFIED',  8),
        col('IDLE',      7),
        col('SIGNED IN', 9),
        col('JOURNEY',   9),
        col('HINTS',     7),
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
        const prefs    = (u.preferences && typeof u.preferences === 'object') ? u.preferences : {}
        const progress = prefs.journeyProgress
        const journey  = progress
          ? Array.from({ length: 8 }, (_, i) =>
              progress.completedSteps?.includes(i + 1) ? '1' : '0'
            ).join('') + (progress.dismissedAt ? 'D' : '')
          : '--------'
        const hints    = formatHints(prefs.uiHints)

        // Colour the dot based on idle status (only for signed-in users).
        // We can't use col() on the dot because ANSI codes inflate the byte
        // length — build the padded dot cell manually (1 visible char + 1 space).
        let dotCell
        if (!u.online) {
          dotCell = '○ '
        } else {
          const idleMs = u.lastActiveAt ? Date.now() - new Date(u.lastActiveAt).getTime() : Infinity
          const color  = idleMs >= warnMs + graceMs ? RED
                       : idleMs >= warnMs           ? YELLOW
                       :                              GREEN
          dotCell = `${color}●${RESET} `
        }

        console.log([
          dotCell,
          col(u.username,                16),
          col(u.email,                   26),
          col(verified,                   8),
          col(u.online ? formatIdle(u.lastActiveAt) : '—', 7),
          col(u.signedInAt ? formatIdle(u.signedInAt) : '—', 9),
          col(journey,                    9),
          hints,                          // ANSI codes — not passed through col()
          col(roles,                     20),
          col(created,                   12),
        ].join('  '))
      }

      console.log(divider)
      console.log(`${rows.length} user(s)`)
    })
}
