import db from '../lib/db.js'
import { resolveUsers, ok, fail } from '../lib/safety.js'

export function hintsCommand(program) {
  program
    .command('hints <username|email|pattern>')
    .description('Show or reset Getting Started hint flags (popup + finger). Accepts a regex pattern to match multiple users.')
    .option('--reset', 'Clear hints so popup and finger show again on next sign-in')
    .action(async (usernameOrEmail, opts) => {
      const users = await resolveUsers(db, usernameOrEmail)
      if (users.length === 0) fail(`no users found matching "${usernameOrEmail}"`)

      for (const user of users) {
        const prefs = (user.preferences && typeof user.preferences === 'object')
          ? user.preferences
          : {}

        if (opts.reset) {
          const { faqHintSeen: _, ...rest } = prefs
          await db.user.update({
            where: { id: user.id },
            data:  { preferences: rest },
          })
          ok(`"${user.username}" hints reset — popup and finger will show on next sign-in`)
        } else {
          const seen = !!prefs.faqHintSeen
          console.log(`"${user.username}" hints:`)
          console.log(`  faqHintSeen: ${seen} — popup + finger will ${seen ? 'NOT show' : 'show'} on next sign-in`)
        }
      }
    })
}
