#!/usr/bin/env node --experimental-transform-types --no-warnings
import { Command } from 'commander'
import { guardProduction } from './lib/safety.js'
import { disconnect } from './lib/db.js'
import { createCommand }  from './commands/create.js'
import { verifyCommand }  from './commands/verify.js'
import { passwordCommand } from './commands/password.js'
import { roleCommand }    from './commands/role.js'
import { listCommand }    from './commands/list.js'
import { deleteCommand }  from './commands/delete.js'
import { idleCommand }    from './commands/idle.js'
import { sessionCommand } from './commands/session.js'
import { renameCommand }  from './commands/rename.js'
import { statusCommand }  from './commands/status.js'
import { hintsCommand }   from './commands/hints.js'

guardProduction()

const program = new Command()

program
  .name('um')
  .description('XO Arena dev user manager')
  .version('1.0.0')

createCommand(program)
verifyCommand(program)
passwordCommand(program)
roleCommand(program)
listCommand(program)
deleteCommand(program)
idleCommand(program)
sessionCommand(program)
renameCommand(program)
statusCommand(program)
hintsCommand(program)

program.hook('postAction', () => disconnect())
program.parse()
