import { config as dotenvConfig } from 'dotenv'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'

// Read --env <name> from argv before dotenv loads (Commander hasn't parsed yet).
const _envIdx = process.argv.indexOf('--env')
export const umEnv = _envIdx !== -1 ? process.argv[_envIdx + 1] : null

// Load backend/.env (or backend/.env.<name> for --env) relative to this file.
const __dirname = dirname(fileURLToPath(import.meta.url))
const envFile = umEnv ? `.env.${umEnv}` : '.env'
const envPath = resolve(__dirname, `../../../${envFile}`)
try { dotenvConfig({ path: envPath }) } catch { /* ignore */ }

// When running on the host (not inside Docker), Docker service hostnames
// ("postgres", "redis") aren't resolvable. Both ports are mapped to localhost,
// so we rewrite the URLs automatically.
// Skip rewriting when --env is set — the .env.<name> file should have the
// correct URL already (e.g. localhost via flyctl proxy for staging).
function fixDockerUrls() {
  if (umEnv) return
  if (existsSync('/.dockerenv')) return

  const db = process.env.DATABASE_URL ?? ''
  if (db) process.env.DATABASE_URL = db.replace('@postgres:', '@localhost:')

  const redis = process.env.REDIS_URL
  if (redis) process.env.REDIS_URL = redis.replace('//redis:', '//localhost:')
}
fixDockerUrls()

export function guardProduction() {
  const isProduction = process.env.NODE_ENV === 'production'
  // Allow when --env staging is explicitly passed
  if (isProduction && umEnv !== 'staging') {
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
