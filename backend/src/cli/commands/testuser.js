// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 5 — `um testuser` (Intelligent_Guide_Requirements.md §10.6).
 *
 * Manipulates the User.isTestUser flag (excludes the user from all dashboard
 * metrics aggregations). Modes:
 *
 *   um testuser <user> --on   # set isTestUser=true
 *   um testuser <user> --off  # clear isTestUser
 *   um testuser --list        # list all flagged users
 *   um testuser --audit       # list users who probably *should* be flagged
 *                             # but aren't (admin role / internal email domain)
 *
 * The audit mode helps catch drift: when a user gets ADMIN granted via the
 * old um role command (pre-Sprint 5) or via a path that bypassed the auto-
 * flag wiring, audit will flag them so an admin can run `um testuser <name>
 * --on` to fix.
 */
import db from '../lib/db.js'
import { resolveUsers, ok, fail } from '../lib/safety.js'

const TEAL  = '\x1b[36m'
const DIM   = '\x1b[2m'
const BOLD  = '\x1b[1m'
const RESET = '\x1b[0m'

async function _internalDomains() {
  const row = await db.systemConfig.findUnique({ where: { key: 'metrics.internalEmailDomains' } })
  if (!row) return []
  try {
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed)
      ? parsed.filter(s => typeof s === 'string').map(s => s.toLowerCase().replace(/^@/, ''))
      : []
  } catch { return [] }
}

function _emailDomain(email) {
  const at = email?.lastIndexOf?.('@') ?? -1
  return at >= 0 ? email.slice(at + 1).toLowerCase() : null
}

export function testuserCommand(program) {
  program
    .command('testuser [usernameOrEmail]')
    .description(
      'Manage the isTestUser flag (excludes from dashboard metrics).\n' +
      '  --on / --off    flip a single user.\n' +
      '  --list          list all flagged users.\n' +
      '  --audit         list users who likely should be flagged but aren\'t.\n'
    )
    .option('--on',    'Set isTestUser=true')
    .option('--off',   'Set isTestUser=false')
    .option('--list',  'List all currently-flagged users')
    .option('--audit', 'List users who likely should be flagged but aren\'t')
    .action(async (usernameOrEmail, opts) => {
      // ── --list ────────────────────────────────────────────────────────────
      if (opts.list) {
        const flagged = await db.user.findMany({
          where:   { isTestUser: true, isBot: false },
          select:  { username: true, email: true, createdAt: true },
          orderBy: { username: 'asc' },
        })
        if (flagged.length === 0) {
          console.log(`${DIM}(no users flagged isTestUser=true)${RESET}`)
          return
        }
        console.log(`${BOLD}${flagged.length} flagged user(s):${RESET}`)
        for (const u of flagged) {
          console.log(`  ${TEAL}●${RESET} ${u.username.padEnd(24)} ${DIM}${u.email}${RESET}`)
        }
        return
      }

      // ── --audit ───────────────────────────────────────────────────────────
      if (opts.audit) {
        const domains = await _internalDomains()
        const candidates = await db.user.findMany({
          where: {
            isTestUser: false,
            isBot:      false,
            OR: [
              { userRoles: { some: { role: 'ADMIN' } } },
              ...(domains.length > 0
                ? domains.map(d => ({ email: { endsWith: `@${d}`, mode: 'insensitive' } }))
                : []),
            ],
          },
          select:  { username: true, email: true, userRoles: { select: { role: true } } },
          orderBy: { username: 'asc' },
        })
        if (candidates.length === 0) {
          console.log(`${DIM}(no audit candidates — all admins / internal emails are flagged)${RESET}`)
          return
        }
        console.log(`${BOLD}${candidates.length} user(s) likely should be flagged:${RESET}`)
        for (const u of candidates) {
          const reasons = []
          if (u.userRoles.some(r => r.role === 'ADMIN')) reasons.push('ADMIN role')
          const dom = _emailDomain(u.email)
          if (dom && domains.includes(dom)) reasons.push(`internal domain @${dom}`)
          console.log(`  ${u.username.padEnd(24)} ${DIM}${u.email}${RESET}  (${reasons.join(', ')})`)
        }
        console.log(`${DIM}fix with: um testuser <name> --on${RESET}`)
        return
      }

      // ── --on / --off (per-user flip) ──────────────────────────────────────
      if (!usernameOrEmail) fail('provide a username/email or use --list / --audit')
      if (!opts.on && !opts.off) fail('specify --on or --off')

      const users = await resolveUsers(db, usernameOrEmail)
      if (users.length === 0) fail(`no users found matching "${usernameOrEmail}"`)
      const desired = !!opts.on

      for (const u of users) {
        if (u.isTestUser === desired) {
          console.log(`  ${DIM}— "${u.username}" already isTestUser=${desired}, skipped${RESET}`)
          continue
        }
        await db.user.update({ where: { id: u.id }, data: { isTestUser: desired } })
        ok(`Set "${u.username}" isTestUser=${desired}`)
      }
    })
}
