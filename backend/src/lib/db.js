// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Prisma client singleton re-exported from @xo-arena/db.
 *
 * Query-level logging is registered here so that the db package remains
 * framework-agnostic (no pino dependency).
 */
import db from '@xo-arena/db'
import logger from '../logger.js'

// Log individual query durations to surface DB bottlenecks. Skipped when
// loaded under the `um` CLI — otherwise every command floods stdout with
// INFO db-query lines after the rendered table, drowning out the output.
// argv[1] is whatever path Node received (symlink path under
// node_modules/.bin/um, or the resolved um.js when run directly), so we
// match either form. UM_CLI=1 is also honoured as a manual override.
const argv1   = typeof process.argv[1] === 'string' ? process.argv[1] : ''
const isUmCli = /(?:^|\/)um(?:\.js)?$/.test(argv1)
if (!isUmCli && !process.env.UM_CLI) {
  db.$on('query', (e) => {
    logger.info({ query: e.query, ms: e.duration }, 'db query')
  })
}

export default db
