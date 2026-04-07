// Minimal Prisma client for the CLI — no query logging.
import db from '@xo-arena/db'
export async function disconnect() { await db.$disconnect() }
export default db
