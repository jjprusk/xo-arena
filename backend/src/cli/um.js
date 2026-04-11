#!/usr/bin/env node --experimental-transform-types --no-warnings
import { Command } from 'commander'
import { guardProduction, umEnv } from './lib/safety.js'
import { disconnect } from './lib/db.js'
import { createCommand }  from './commands/create.js'
import { cloneCommand }   from './commands/clone.js'
import { verifyCommand }  from './commands/verify.js'
import { passwordCommand } from './commands/password.js'
import { roleCommand }    from './commands/role.js'
import { listCommand }    from './commands/list.js'
import { deleteCommand }  from './commands/delete.js'
import { idleCommand }    from './commands/idle.js'
import { sessionCommand } from './commands/session.js'
import { renameCommand }  from './commands/rename.js'
import { statusCommand }  from './commands/status.js'
import { hintsCommand }        from './commands/hints.js'
import { journeyCommand }      from './commands/journey.js'
import { sessionConfigCommand } from './commands/sessionconfig.js'
import { envCommand }          from './commands/env.js'

guardProduction()

// ── Environment banner ────────────────────────────────────────────────────────
const RESET  = '\x1b[0m'
const BOLD   = '\x1b[1m'
const GREEN  = '\x1b[32m'
const YELLOW = '\x1b[93m'

function dbHost() {
  const url = process.env.DATABASE_URL
  if (!url) return '(DATABASE_URL not set)'
  try {
    const { host, port, pathname } = new URL(url)
    return `${host}${port ? `:${port}` : ''}${pathname}`
  } catch { return '(unparseable)' }
}

function printEnvBanner() {
  if (umEnv) {
    const label = umEnv.toUpperCase().padEnd(8)
    process.stderr.write(`${BOLD}${YELLOW}[ ${label}]${RESET} db @ ${dbHost()}\n`)
  } else {
    process.stderr.write(`${BOLD}${GREEN}[ LOCAL   ]${RESET} db @ ${dbHost()}\n`)
  }
}

const program = new Command()

program
  .name('um')
  .description('XO Arena dev user manager')
  .version('1.0.0')
  .option('--env <name>', 'load .env.<name> and connect to that environment (e.g. staging)')

program.hook('preAction', printEnvBanner)

createCommand(program)
cloneCommand(program)
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
journeyCommand(program)
sessionConfigCommand(program)
envCommand(program)

program.hook('postAction', () => disconnect())
program.parse()
