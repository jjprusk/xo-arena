// Copyright © 2026 Joe Pruskowski. All rights reserved.
import db from '../lib/db.js'
import { resolveUser, ok, fail } from '../lib/safety.js'

export function renameCommand(program) {
  program
    .command('rename <username|email> <new-username>')
    .description("Change a user's username")
    .action(async (usernameOrEmail, newUsername) => {
      const user = await resolveUser(db, usernameOrEmail)

      if (user.username === newUsername) fail(`"${newUsername}" is already their username`)

      try {
        await db.user.update({
          where: { id: user.id },
          data:  { username: newUsername },
        })
        ok(`Renamed "${user.username}" → "${newUsername}"`)
      } catch (err) {
        if (err.code === 'P2002') fail(`username "${newUsername}" is already taken`)
        throw err
      }
    })
}
