import db from '../lib/db.js'
import { resolveUsers, ok, fail } from '../lib/safety.js'

export function hintsCommand(program) {
  program
    .command('hints <username|email|pattern>')
    .description('Show or reset hint flags (Guide popup, play-page finger). Accepts a regex pattern to match multiple users.')
    .option('--reset', 'Clear all hints so they show again on next visit')
    .action(async (usernameOrEmail, opts) => {
      const users = await resolveUsers(db, usernameOrEmail)
      if (users.length === 0) fail(`no users found matching "${usernameOrEmail}"`)

      for (const user of users) {
        const prefs = (user.preferences && typeof user.preferences === 'object')
          ? user.preferences
          : {}

        if (opts.reset) {
          const { faqHintSeen: _f, playHintSeen: _p, ...rest } = prefs
          await db.user.update({
            where: { id: user.id },
            data:  { preferences: rest },
          })
          ok(`"${user.username}" hints reset — Guide popup, FAQ finger, and play-page finger will show on next visit`)
        } else {
          console.log(`"${user.username}" hints:`)
          console.log(`  faqHintSeen:  ${!!prefs.faqHintSeen}  — Guide popup + FAQ finger will ${prefs.faqHintSeen ? 'NOT show' : 'show'} on next sign-in`)
          console.log(`  playHintSeen: ${!!prefs.playHintSeen} — play-page finger will ${prefs.playHintSeen ? 'NOT show' : 'show'} on next visit`)
        }
      }
    })
}
