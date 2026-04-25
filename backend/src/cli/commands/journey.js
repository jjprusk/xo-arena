// Copyright © 2026 Joe Pruskowski. All rights reserved.
import db from '../lib/db.js'
import { resolveUsers, ok, fail } from '../lib/safety.js'
import { deriveCurrentPhase, TOTAL_STEPS, STEP_TITLES } from '../../services/journeyService.js'

const TEAL   = '\x1b[36m'
const YELLOW = '\x1b[33m'
const DIM    = '\x1b[2m'
const BOLD   = '\x1b[1m'
const RESET  = '\x1b[0m'

/** Convert completedSteps array to a TOTAL_STEPS-char binary string. */
function toBinary(completedSteps) {
  return Array.from({ length: TOTAL_STEPS }, (_, i) =>
    completedSteps.includes(i + 1) ? '1' : '0'
  ).join('')
}

/** Convert a binary string like "1100000" back to a completedSteps array. */
function fromBinary(bin) {
  return bin.split('').flatMap((c, i) => c === '1' ? [i + 1] : [])
}

const ALL_ZERO = '0'.repeat(TOTAL_STEPS)
const ALL_ONE  = '1'.repeat(TOTAL_STEPS)
const BITS_RE  = new RegExp(`^[01]{${TOTAL_STEPS}}$`)

// Phase → canonical completed-steps state (for --phase and --graduate shortcuts).
// Hook phase "starting state" = no steps done. Curriculum "starting state" =
// Hook complete (steps 1 + 2). Specialize "starting state" = all done.
const PHASE_STATES = {
  hook:       ALL_ZERO,
  curriculum: '1100000',
  specialize: ALL_ONE,
}

/** Pretty-print the binary: [●●○○○○○] with teal for completed steps. */
function prettyBinary(completedSteps) {
  const bits = Array.from({ length: TOTAL_STEPS }, (_, i) => {
    const done = completedSteps.includes(i + 1)
    return done ? `${TEAL}●${RESET}` : `${DIM}○${RESET}`
  }).join('')
  return `[${bits}]`
}

function phaseLabel(completedSteps) {
  const phase = deriveCurrentPhase(completedSteps)
  const color = phase === 'specialize' ? TEAL : phase === 'curriculum' ? YELLOW : DIM
  return `${color}${phase}${RESET}`
}

export function journeyCommand(program) {
  program
    .command('journey <username|email|pattern> [bits]')
    .description(
      'Show or set journey progress (Intelligent Guide v1, 7 steps).\n' +
      `  [bits]          ${TOTAL_STEPS}-char binary string (e.g. ${'1'.padEnd(TOTAL_STEPS, '0')}) to set explicit completed steps.\n` +
      `  --phase <name>  Shortcut: hook (${ALL_ZERO}) | curriculum (${PHASE_STATES.curriculum}) | specialize (${ALL_ONE}).\n` +
      `  --graduate      Alias for --phase specialize.\n` +
      `  --reset         Equivalent to --phase hook. Clears discovery rewards and dismissal state too.\n` +
      `  --dismiss       Mark journey dismissed (sets dismissedAt = now).\n` +
      `  --undismiss     Clear dismissedAt so the Guide is active again.\n`
    )
    .option('--phase <name>', 'Set the user to the canonical start of a phase (hook | curriculum | specialize)')
    .option('--graduate', 'Alias for --phase specialize')
    .option('--reset', `Deep reset — clears completed steps, discovery rewards, and dismissal state`)
    .option('--dismiss', 'Mark journey as dismissed (sets dismissedAt to now)')
    .option('--undismiss', 'Clear dismissedAt so journey is active again')
    .action(async (usernameOrEmail, bits, opts) => {
      const users = await resolveUsers(db, usernameOrEmail)
      if (users.length === 0) fail(`no users found matching "${usernameOrEmail}"`)

      // Validate bits if provided
      if (bits !== undefined && !BITS_RE.test(bits)) {
        fail(`bits must be exactly ${TOTAL_STEPS} characters of 0 or 1, e.g. ${'1'.padEnd(TOTAL_STEPS, '0')}`)
      }

      // Resolve phase/graduate shortcuts to a bits string
      let effectiveBits = bits
      if (opts.graduate) opts.phase = 'specialize'
      if (opts.phase) {
        if (!PHASE_STATES[opts.phase]) fail(`--phase must be one of: ${Object.keys(PHASE_STATES).join(', ')}`)
        effectiveBits = PHASE_STATES[opts.phase]
      }

      for (const user of users) {
        const prefs    = (user.preferences && typeof user.preferences === 'object') ? user.preferences : {}
        const progress = prefs.journeyProgress ?? { completedSteps: [], dismissedAt: null }
        const current  = Array.isArray(progress.completedSteps) ? progress.completedSteps : []

        // Read-only mode: no write flags set
        if (effectiveBits === undefined && !opts.dismiss && !opts.undismiss && !opts.reset) {
          const binary     = toBinary(current)
          const pretty     = prettyBinary(current)
          const phase      = phaseLabel(current)
          const currentStepLabel = current.length < TOTAL_STEPS
            ? `${DIM}next: ${STEP_TITLES[current.length + 1]}${RESET}`
            : `${DIM}(all complete)${RESET}`
          const dismissed  = progress.dismissedAt
            ? `${YELLOW}dismissed ${new Date(progress.dismissedAt).toISOString().slice(0, 16).replace('T', ' ')}${RESET}`
            : `${DIM}active${RESET}`
          console.log(
            `${BOLD}"${user.username}"${RESET}  ${pretty}  ${binary}  ` +
            `(${current.length}/${TOTAL_STEPS})  [${phase}]  ${currentStepLabel}  ${dismissed}`
          )
          continue
        }

        // Write mode — build the updated prefs
        const updatedProgress = { ...progress }
        let updatedPrefs      = prefs

        if (opts.reset) {
          effectiveBits = ALL_ZERO
          updatedProgress.dismissedAt = null
          // Deep reset: clear discovery-reward markers + any v1.1 stagnation
          // state that may have accumulated. Once earned, SlotGrid slots
          // stay per requirements §9.3 — we do NOT re-lock them.
          updatedPrefs = { ...prefs }
          delete updatedPrefs.discoveryRewardsGranted
          delete updatedPrefs.specializeState
        }

        if (effectiveBits !== undefined) {
          updatedProgress.completedSteps = fromBinary(effectiveBits)
          if (effectiveBits !== ALL_ONE) updatedProgress.dismissedAt = null
        }

        if (opts.dismiss)   updatedProgress.dismissedAt = new Date().toISOString()
        if (opts.undismiss) updatedProgress.dismissedAt = null

        await db.user.update({
          where: { id: user.id },
          data:  { preferences: { ...updatedPrefs, journeyProgress: updatedProgress } },
        })

        const newSteps = updatedProgress.completedSteps ?? current
        const pretty   = prettyBinary(newSteps)
        const binary   = toBinary(newSteps)
        const phase    = phaseLabel(newSteps)
        ok(`${BOLD}"${user.username}"${RESET}  ${pretty}  ${binary}  (${newSteps.length}/${TOTAL_STEPS})  [${phase}]`)
      }
    })
}
