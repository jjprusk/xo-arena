// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Prisma client singleton re-exported from @xo-arena/db.
 *
 * Query-level logging is registered here so that the db package remains
 * framework-agnostic (no pino dependency).
 */
import db from '@xo-arena/db'
import logger from '../logger.js'

// Log individual query durations to surface DB bottlenecks
db.$on('query', (e) => {
  logger.info({ query: e.query, ms: e.duration }, 'db query')
})

export default db
