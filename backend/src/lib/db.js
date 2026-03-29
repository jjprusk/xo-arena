/**
 * Prisma client singleton with PrismaPg driver adapter.
 *
 * The adapter replaces Prisma's Rust query engine binary with a direct
 * TCP connection to Postgres via the `pg` driver. This eliminates the
 * IPC subprocess overhead (~20-50ms per query) that was present in the
 * default Prisma setup.
 */
import { PrismaClient } from '../generated/prisma/client.ts'
import { PrismaPg } from '@prisma/adapter-pg'
import logger from '../logger.js'

const globalForPrisma = globalThis

if (!globalForPrisma.prisma) {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  globalForPrisma.prisma = new PrismaClient({
    adapter,
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'stdout', level: 'warn' },
      { emit: 'stdout', level: 'error' },
    ],
  })
  // Log individual query durations to surface DB bottlenecks
  globalForPrisma.prisma.$on('query', (e) => {
    logger.info({ query: e.query, ms: e.duration }, 'db query')
  })
}

const db = globalForPrisma.prisma

export default db
