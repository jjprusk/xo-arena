import { config as dotenvConfig } from 'dotenv'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'

// Load backend/.env using a path relative to this file, not cwd.
// This ensures the right .env is found regardless of where `um` is invoked.
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../../../.env')
dotenvConfig({ path: envPath })

// When running on the host (not inside Docker), the DATABASE_URL uses the
// Docker service hostname "postgres" which isn't resolvable from outside.
// Port 5432 is mapped to localhost, so we rewrite the URL automatically.
function fixDatabaseUrl() {
  const url = process.env.DATABASE_URL
  if (!url) return
  // If we're inside Docker, /.dockerenv exists — leave URL unchanged
  if (existsSync('/.dockerenv')) return
  process.env.DATABASE_URL = url.replace('@postgres:', '@localhost:')
}
fixDatabaseUrl()

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
