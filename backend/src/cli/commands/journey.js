import db from '../lib/db.js'
import { resolveUsers, ok, fail } from '../lib/safety.js'

const TOTAL_STEPS = 8

const TEAL  = '\x1b[36m'
const DIM   = '\x1b[2m'
const RESET = '\x1b[0m'

/**
 * Convert completedSteps array to a 7-char binary string.
 * e.g. [1, 3] → "1010000"
 */
function toBinary(completedSteps) {
  return Array.from({ length: TOTAL_STEPS }, (_, i) =>
    completedSteps.includes(i + 1) ? '1' : '0'
  ).join('')
}

/**
 * Convert a binary string like "1100000" back to a completedSteps array.
 */
function fromBinary(bin) {
  return bin.split('').flatMap((c, i) => c === '1' ? [i + 1] : [])
}

/**
 * Pretty-print the binary: [●●○○○○○] with teal for completed steps.
 */
function prettyBinary(completedSteps) {
  const bits = Array.from({ length: TOTAL_STEPS }, (_, i) => {
    const done = completedSteps.includes(i + 1)
    return done ? `${TEAL}●${RESET}` : `${DIM}○${RESET}`
  }).join('')
  return `[${bits}]`
}

export function journeyCommand(program) {
  program
    .command('journey <username|email|pattern> [bits]')
    .description(
      'Show or set journey progress. Accepts a regex pattern to match multiple users.\n' +
      '  [bits]  optional 8-char binary string e.g. 11000000 to set completed steps.\n' +
      '          Use "00000000" to reset, "11111111" to mark all done.'
    )
    .option('--dismiss', 'Mark journey as dismissed (sets dismissedAt to now)')
    .option('--undismiss', 'Clear dismissedAt so journey is active again')
    .option('--reset', 'Reset all completed steps to 00000000')
    .action(async (usernameOrEmail, bits, opts) => {
      const users = await resolveUsers(db, usernameOrEmail)
      if (users.length === 0) fail(`no users found matching "${usernameOrEmail}"`)

      // Validate bits if provided
      if (bits !== undefined) {
        if (!/^[01]{8}$/.test(bits)) fail(`bits must be exactly 8 characters of 0 or 1, e.g. 11000000`)
      }

      for (const user of users) {
        const prefs    = (user.preferences && typeof user.preferences === 'object') ? user.preferences : {}
        const progress = prefs.journeyProgress ?? { completedSteps: [], dismissedAt: null }
        const current  = Array.isArray(progress.completedSteps) ? progress.completedSteps : []

        // Read-only mode
        if (bits === undefined && !opts.dismiss && !opts.undismiss && !opts.reset) {
          const binary     = toBinary(current)
          const pretty     = prettyBinary(current)
          const dismissed  = progress.dismissedAt
            ? `dismissed ${new Date(progress.dismissedAt).toISOString().slice(0, 16).replace('T', ' ')}`
            : 'active'
          console.log(`"${user.username}"  ${pretty}  ${binary}  (${current.length}/${TOTAL_STEPS})  ${dismissed}`)
          continue
        }

        // Write mode
        const updated = { ...progress }

        if (opts.reset) {
          updated.completedSteps = []
          updated.dismissedAt    = null
        }
        if (bits !== undefined) {
          updated.completedSteps = fromBinary(bits)
          if (bits !== '11111111') updated.dismissedAt = null
        }
        if (opts.dismiss) {
          updated.dismissedAt = new Date().toISOString()
        }
        if (opts.undismiss) {
          updated.dismissedAt = null
        }

        await db.user.update({
          where: { id: user.id },
          data:  { preferences: { ...prefs, journeyProgress: updated } },
        })

        const newPretty = prettyBinary(updated.completedSteps ?? current)
        const newBinary = toBinary(updated.completedSteps ?? current)
        ok(`"${user.username}"  ${newPretty}  ${newBinary}  (${(updated.completedSteps ?? current).length}/${TOTAL_STEPS})`)
      }
    })
}
