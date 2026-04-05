import db from '../lib/db.js'
import { resolveUsers, ok, fail } from '../lib/safety.js'

const HINT_DEFS = {
  faq:  { key: 'faqHintSeen',  label: 'Guide popup + FAQ finger',  when: 'next sign-in' },
  play: { key: 'playHintSeen', label: 'play-page finger',          when: 'next visit'   },
}

export function hintsCommand(program) {
  program
    .command('hints <username|email|pattern>')
    .description('Show or reset hint flags. Accepts a regex pattern to match multiple users.')
    .option('--hint <name>', `Target a specific hint (${Object.keys(HINT_DEFS).join('|')}); omit for all`)
    .option('--reset', 'Clear hint(s) so they show again')
    .action(async (usernameOrEmail, opts) => {
      const users = await resolveUsers(db, usernameOrEmail)
      if (users.length === 0) fail(`no users found matching "${usernameOrEmail}"`)

      // Validate --hint value if provided
      if (opts.hint && !HINT_DEFS[opts.hint]) {
        fail(`unknown hint "${opts.hint}" — valid values: ${Object.keys(HINT_DEFS).join(', ')}`)
      }

      const targets = opts.hint
        ? { [opts.hint]: HINT_DEFS[opts.hint] }
        : HINT_DEFS

      for (const user of users) {
        const prefs = (user.preferences && typeof user.preferences === 'object')
          ? user.preferences
          : {}

        if (opts.reset) {
          const updated = { ...prefs }
          for (const { key } of Object.values(targets)) delete updated[key]
          await db.user.update({ where: { id: user.id }, data: { preferences: updated } })
          const names = Object.values(targets).map(d => d.label).join(', ')
          ok(`"${user.username}" reset — ${names} will show again`)
        } else {
          console.log(`"${user.username}" hints:`)
          for (const [name, { key, label, when }] of Object.entries(targets)) {
            const seen = !!prefs[key]
            console.log(`  ${name.padEnd(6)} (${key}): ${String(seen).padEnd(5)} — ${label} will ${seen ? 'NOT show' : 'show'} on ${when}`)
          }
        }
      }
    })
}
