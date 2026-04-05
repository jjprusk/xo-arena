import { config as dotenvConfig } from 'dotenv'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'

// Load backend/.env using a path relative to this file, not cwd.
// This ensures the right .env is found regardless of where `um` is invoked.
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../../../.env')
try { dotenvConfig({ path: envPath }) } catch { /* cwd may not exist when invoked from a deleted directory */ }

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

/**
 * Resolve a username/email/regex pattern to one or more User rows.
 *
 * Resolution order:
 *  1. If pattern contains '@'            → exact email match (exits if not found)
 *  2. Exact username match               → returns [user]
 *  3. Pattern contains regex special chars → regex filter over all non-bot users
 *  4. No match and no regex chars         → exits with "not found"
 */
export async function resolveUsers(db, pattern) {
  // Email: always exact
  if (pattern.includes('@')) {
    const user = await db.user.findUnique({
      where: { email: pattern },
      include: { userRoles: true },
    })
    if (!user) {
      console.error(`um: user not found: ${pattern}`)
      process.exit(1)
    }
    return [user]
  }

  // Try exact username first
  const exact = await db.user.findUnique({
    where: { username: pattern },
    include: { userRoles: true },
  })
  if (exact) return [exact]

  // Regex fallback — only if pattern contains special chars
  if (/[.*+?^${}()|[\]\\]/.test(pattern)) {
    let re
    try {
      re = new RegExp(pattern, 'i')
    } catch {
      console.error(`um: invalid regex: ${pattern}`)
      process.exit(1)
    }
    const all = await db.user.findMany({
      where:   { isBot: false },
      orderBy: { username: 'asc' },
      include: { userRoles: true },
    })
    return all.filter(u => re.test(u.username))
  }

  // No match
  console.error(`um: user not found: ${pattern}`)
  process.exit(1)
}

export function ok(msg) {
  console.log(`✓ ${msg}`)
}

export function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
