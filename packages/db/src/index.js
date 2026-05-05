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
import pg from 'pg'

export { Prisma }

const globalForPrisma = globalThis

if (!globalForPrisma.prisma) {
  // Construct our own pg.Pool so callers can read live pool stats
  // (totalCount / idleCount / waitingCount) for F9 instrumentation.
  // PrismaPg accepts either a connection string, PoolConfig, or an
  // existing pg.Pool — passing the Pool gives us the handle.
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    // See doc/Performance_Plan_v2.md §F9.1: pool was bumped 10 → 30 on
    // 2026-05-05 v1.4.0-alpha-4.3. Validation showed no measurable apply
    // p95 gain (pool was at ~4% utilisation, never the bottleneck) but
    // kept as free hedge for c≥100.
    max: 30,
    // Release idle connections after 15s so they are closed cleanly before
    // the Fly.io Postgres server terminates them (~30s idle timeout).
    // Without this, the scheduler (30s tick) and snapshot (60s tick) hit
    // dead connections and log "Connection terminated unexpectedly", which
    // stalls the pool and makes all subsequent auth queries wait 6–31 s.
    idleTimeoutMillis: 15_000,
    connectionTimeoutMillis: 10_000,
  })
  globalForPrisma.pgPool = pool
  const adapter = new PrismaPg(pool)
  globalForPrisma.prisma = new PrismaClient({
    adapter,
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'stdout', level: 'warn' },
      { emit: 'stdout', level: 'error' },
    ],
  })
}

/**
 * Live pg.Pool stats: { total, idle, waiting }. Cheap (synchronous
 * property reads). Used by realtime.js to surface pool pressure in
 * Server-Timing headers under load.
 */
export function getPoolStats() {
  const p = globalForPrisma.pgPool
  if (!p) return { total: 0, idle: 0, waiting: 0 }
  return { total: p.totalCount, idle: p.idleCount, waiting: p.waitingCount }
}

/**
 * End the underlying pg.Pool. `prisma.$disconnect()` releases Prisma's
 * adapter but does NOT close connections owned by a manually-constructed
 * pool; without this, short-lived processes (the `um` CLI) hang for
 * `idleTimeoutMillis` (15s) before Node's event loop drains. Long-lived
 * services (the backend server) never call this — pool lifetime matches
 * the process.
 */
export async function closePool() {
  const p = globalForPrisma.pgPool
  if (!p) return
  globalForPrisma.pgPool = null
  try { await p.end() } catch { /* idempotent — already ended */ }
}

export const db = globalForPrisma.prisma
export default db
