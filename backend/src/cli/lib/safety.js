import { config as dotenvConfig } from 'dotenv'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'

// Load backend/.env using a path relative to this file, not cwd.
// This ensures the right .env is found regardless of where `um` is invoked.
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../../../.env')
dotenvConfig({ path: envPath })

// When running on the host (not inside Docker), Docker service hostnames
// ("postgres", "redis") aren't resolvable. Both ports are mapped to localhost,
// so we rewrite the URLs automatically.
function fixDockerUrls() {
  if (existsSync('/.dockerenv')) return
  const db = process.env.DATABASE_URL
  if (db) process.env.DATABASE_URL = db.replace('@postgres:', '@localhost:')
  const redis = process.env.REDIS_URL
  if (redis) process.env.REDIS_URL = redis.replace('//redis:', '//localhost:')
}
fixDockerUrls()

export function guardProduction() {
  if (process.env.NODE_ENV === 'production') {
    console.error('um: refuses to run in production')
    process.exit(1)
  }
}

/**
 * Resolve a username-or-email string to a User row (with betterAuthId).
 * Exits with an error if the user is not found.
 */
export async function resolveUser(db, usernameOrEmail) {
  const isEmail = usernameOrEmail.includes('@')
  const user = await db.user.findUnique({
    where: isEmail
      ? { email: usernameOrEmail }
      : { username: usernameOrEmail },
    include: { userRoles: true },
  })
  if (!user) {
    console.error(`um: user not found: ${usernameOrEmail}`)
    process.exit(1)
  }
  return user
}

export function ok(msg) {
  console.log(`✓ ${msg}`)
}

export function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
