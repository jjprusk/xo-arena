// Copyright © 2026 Joe Pruskowski. All rights reserved.
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
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    // Pool size: pg.Pool defaults to max=10. Under c=25+ concurrent moves
    // each request needs 2 queries (findUnique + update) and the pool
    // queues — measured 5.6× apply p95 growth (8 → 45ms) at c=25 on
    // staging 2026-05-05. 30 is well below Fly Postgres' 100+ default
    // max_connections and gives headroom for tournament service too.
    // See doc/Performance_Plan_v2.md §F9 for the audit.
    max: 30,
    // Release idle connections after 15s so they are closed cleanly before the
    // Fly.io Postgres server terminates them (~30s idle timeout). Without this,
    // the scheduler (30s tick) and snapshot (60s tick) hit dead connections and
    // log "Connection terminated unexpectedly", which stalls the connection pool
    // and makes all subsequent auth queries wait 6–31 seconds.
    idleTimeoutMillis: 15_000,
    connectionTimeoutMillis: 10_000,
  })
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
