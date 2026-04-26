// Copyright © 2026 Joe Pruskowski. All rights reserved.
import db from '../lib/db.js'
import { resolveUsers, fail } from '../lib/safety.js'
import { deriveCurrentPhase, TOTAL_STEPS } from '../../services/journeyService.js'

const TEAL   = '\x1b[36m'
const YELLOW = '\x1b[33m'
const DIM    = '\x1b[2m'
const RESET  = '\x1b[0m'

function _phaseLabel(completedSteps) {
  const phase = deriveCurrentPhase(completedSteps)
  const color = phase === 'specialize' ? TEAL : phase === 'curriculum' ? YELLOW : DIM
  return `${color}${phase}${RESET}`
}

export function statusCommand(program) {
  program
    .command('status <username|email|pattern>')
    .description(
      'Show sessions + Intelligent Guide state for a user.\n' +
      '  Sprint 5 additions: phase, isTestUser, discovery grants, TC balance.\n' +
      '  Accepts a regex pattern to match multiple users.'
    )
    .action(async (usernameOrEmail) => {
      const users = await resolveUsers(db, usernameOrEmail)
      if (users.length === 0) fail(`no users found matching "${usernameOrEmail}"`)

      for (const user of users) {
        // ── Sessions (legacy behaviour, kept for muscle memory) ───────────
        if (!user.betterAuthId) {
          console.log(`○ "${user.username}" has no BetterAuth account`)
        } else {
          const sessions = await db.baSession.findMany({
            where:   { userId: user.betterAuthId, expiresAt: { gt: new Date() } },
            orderBy: { expiresAt: 'desc' },
          })
          if (sessions.length === 0) {
            console.log(`○ "${user.username}" has no active sessions`)
          } else {
            const s = sessions.length === 1 ? 'session' : 'sessions'
            console.log(`● "${user.username}" has ${sessions.length} active ${s}`)
            for (const session of sessions) {
              const expires = session.expiresAt.toISOString().slice(0, 16).replace('T', ' ')
              const ua = session.userAgent ? `  ${session.userAgent.slice(0, 60)}` : ''
              console.log(`  expires ${expires}${ua}`)
            }
          }
        }

        // ── Sprint 5 additions: Guide state ───────────────────────────────
        const prefs    = (user.preferences && typeof user.preferences === 'object') ? user.preferences : {}
        const progress = prefs.journeyProgress ?? { completedSteps: [] }
        const steps    = Array.isArray(progress.completedSteps) ? progress.completedSteps : []
        const granted  = Array.isArray(prefs.discoveryRewardsGranted) ? prefs.discoveryRewardsGranted : []
        const phase    = _phaseLabel(steps)
        const tcLabel  = `${user.creditsTc ?? 0} TC`
        const testUser = user.isTestUser ? `${YELLOW}isTestUser${RESET}` : `${DIM}—${RESET}`
        const grants   = granted.length === 0 ? `${DIM}none${RESET}` : granted.join(', ')
        console.log(
          `  guide:   phase=${phase}  steps=${steps.length}/${TOTAL_STEPS}  ` +
          `${tcLabel}  flag=${testUser}`
        )
        console.log(`  rewards: ${grants}`)
      }
    })
}
