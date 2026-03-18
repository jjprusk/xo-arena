/**
 * Prisma client singleton.
 * Prevents multiple connections during hot reload in development.
 */
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

const db = globalForPrisma.prisma

export default db
