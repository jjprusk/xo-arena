// Copyright © 2026 Joe Pruskowski. All rights reserved.
// Minimal Prisma client for the CLI — no query logging.
import db, { closePool } from '@xo-arena/db'
export async function disconnect() {
  await db.$disconnect()
  await closePool()
}
export default db
