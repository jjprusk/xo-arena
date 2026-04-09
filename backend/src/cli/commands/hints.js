import db from '../lib/db.js'
import { resolveUsers, ok, fail } from '../lib/safety.js'

const GREEN = '\x1b[32m'
const DIM   = '\x1b[2m'
const RESET = '\x1b[0m'

/**
 * All known uiHints keys with human-readable labels.
 * Stored at preferences.uiHints.<key>.
 */
const HINT_DEFS = {
  faqTipShown:     'FAQ "Take your time" tip modal',
  faqPointerShown: 'Guide slot finger pointer (Read the FAQ)',
}

export function hintsCommand(program) {
  program
    .command('hints <username|email|pattern>')
    .description(
      'Show, set, or reset uiHints flags. Accepts a regex pattern to match multiple users.\n' +
      `  Known keys: ${Object.keys(HINT_DEFS).join(', ')}`
    )
    .option('--hint <key>', 'Target a specific hint key; omit for all')
    .option('--set',   'Mark hint(s) as seen (true)')
    .option('--reset', 'Clear hint(s) so they show again')
    .action(async (usernameOrEmail, opts) => {
      const users = await resolveUsers(db, usernameOrEmail)
      if (users.length === 0) fail(`no users found matching "${usernameOrEmail}"`)

      if (opts.set && opts.reset) fail('--set and --reset are mutually exclusive')

      if (opts.hint && !HINT_DEFS[opts.hint]) {
        const known = Object.keys(HINT_DEFS).join(', ')
        fail(`unknown hint key "${opts.hint}" — known keys: ${known}`)
      }

      for (const user of users) {
        const prefs    = (user.preferences && typeof user.preferences === 'object') ? user.preferences : {}
        const uiHints  = (prefs.uiHints    && typeof prefs.uiHints    === 'object') ? prefs.uiHints    : {}

        // ── Read-only ─────────────────────────────────────────────────
        if (!opts.set && !opts.reset) {
          const keys = opts.hint ? [opts.hint] : Object.keys(HINT_DEFS)
          console.log(`"${user.username}" uiHints:`)
          for (const key of keys) {
            const val    = !!uiHints[key]
            const label  = HINT_DEFS[key] ?? key
            const status = val
              ? `${GREEN}seen${RESET}    — will NOT show again`
              : `${DIM}unseen${RESET}  — will show`
            console.log(`  ${key.padEnd(20)} ${status}   ${DIM}(${label})${RESET}`)
          }

          // Also surface any unknown keys stored in uiHints
          const unknown = Object.keys(uiHints).filter(k => !HINT_DEFS[k])
          if (unknown.length) {
            for (const k of unknown) {
              console.log(`  ${k.padEnd(20)} ${DIM}(unrecognised key: ${JSON.stringify(uiHints[k])})${RESET}`)
            }
          }
          continue
        }

        // ── Write mode ────────────────────────────────────────────────
        const targetKeys = opts.hint ? [opts.hint] : Object.keys(HINT_DEFS)
        const updatedHints = { ...uiHints }

        if (opts.reset) {
          for (const k of targetKeys) delete updatedHints[k]
        } else {
          for (const k of targetKeys) updatedHints[k] = true
        }

        await db.user.update({
          where: { id: user.id },
          data:  { preferences: { ...prefs, uiHints: updatedHints } },
        })

        const verb  = opts.reset ? 'reset' : 'set'
        const names = targetKeys.map(k => HINT_DEFS[k] ?? k).join(', ')
        ok(`"${user.username}" ${verb} — ${names}`)
      }
    })
}
