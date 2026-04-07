/**
 * Shared Prisma client and repository layer.
 *
 * This package is the sole source of truth for the Prisma schema and generated
 * client. The backend is the sole migration authority and runs prisma migrate
 * deploy on startup. No other service runs migrations.
 */
import { PrismaClient, Prisma } from './generated/prisma/client.ts'
import { PrismaPg } from '@prisma/adapter-pg'

export { Prisma }

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
}

export const db = globalForPrisma.prisma
export default db
