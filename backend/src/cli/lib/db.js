// Minimal Prisma client for the CLI — no query logging.
import { PrismaClient } from '../../generated/prisma/client.ts'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const db = new PrismaClient({ adapter })

export async function disconnect() { await db.$disconnect() }

export default db
