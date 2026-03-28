/**
 * Prisma client singleton with PrismaPg driver adapter.
 *
 * The adapter replaces Prisma's Rust query engine binary with a direct
 * TCP connection to Postgres via the `pg` driver. This eliminates the
 * IPC subprocess overhead (~20-50ms per query) that was present in the
 * default Prisma setup.
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis

if (!globalForPrisma.prisma) {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  globalForPrisma.prisma = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

const db = globalForPrisma.prisma

export default db
