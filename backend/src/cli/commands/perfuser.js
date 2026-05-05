// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * `um perfuser` — manage the synthetic user used by perf benches.
 *
 * Creates (idempotent) a flagged test user `xo_perf` with a known
 * password, then signs them in and prints a JWT bearer token suitable
 * for `PERF_AUTH_TOKEN` in `perf/perf-backend-p95.js`.
 *
 *   docker compose exec -T backend node --experimental-transform-types --no-warnings \
 *     src/cli/um.js perfuser
 *
 * Output is shell-export form so it composes with the perf script:
 *
 *   eval "$(docker compose exec -T backend ... perfuser)"
 *   node perf/perf-backend-p95.js --target=local
 *
 * The user is flagged isTestUser=true (matches `um create` default) so
 * dashboard metrics aren't polluted, and is given no special roles.
 *
 * For staging / prod, point the CLI at that env's DB with
 * `--env=staging` (uses the same proxy plumbing as every other um
 * command). The token-mint flow signs in against `localhost:3000`,
 * which inside the Docker network resolves to the local backend — for
 * remote token mint, sign in manually via the env's auth endpoint and
 * pass the resulting JWT directly to PERF_AUTH_TOKEN.
 */
import db from '../lib/db.js'
import { ok, fail } from '../lib/safety.js'
import { createUser } from './create.js'

const PERF_USERNAME = 'xo_perf'
const PERF_EMAIL    = 'xo_perf@dev.local'
const PERF_PASSWORD = 'xo_perf_pwd_2026'

async function ensurePerfUser() {
  const existing = await db.user.findFirst({ where: { username: PERF_USERNAME } })
  if (existing) return { created: false, user: existing }

  await createUser({
    username:    PERF_USERNAME,
    email:       PERF_EMAIL,
    displayName: 'XO Perf User',
    password:    PERF_PASSWORD,
    verified:    true,
    roles:       [],
  })
  const user = await db.user.findFirst({ where: { username: PERF_USERNAME } })
  return { created: true, user }
}

async function mintToken(baseUrl, origin) {
  // Better Auth requires an Origin header that matches its trustedOrigins
  // allow-list — without it, requests are rejected with
  // MISSING_OR_NULL_ORIGIN or CORS-not-allowed. The default 5173 is the
  // frontend dev origin (`FRONTEND_URL` fallback in lib/auth.js); pass
  // --origin for a different env.
  const originHeaders = { Origin: origin }

  // Step 1: sign in with credentials → captures session cookie.
  const signinRes = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...originHeaders },
    body:    JSON.stringify({ email: PERF_EMAIL, password: PERF_PASSWORD }),
  })
  if (!signinRes.ok) {
    const body = await signinRes.text().catch(() => '')
    throw new Error(`sign-in failed: ${signinRes.status} ${body.slice(0, 200)}`)
  }
  // Better Auth returns the session token in the Set-Cookie header.
  // Forward every cookie back unchanged — the JWT plugin will read it
  // off the next request.
  const setCookie = signinRes.headers.get('set-cookie')
  if (!setCookie) throw new Error('sign-in succeeded but no Set-Cookie returned')
  // Set-Cookie can be multi-valued; reduce to a single Cookie header.
  const cookie = setCookie.split(/,(?=\s*[\w!#$%&'*+\-.^_`|~]+=)/)
    .map(part => part.split(';')[0].trim())
    .filter(Boolean)
    .join('; ')

  // Step 2: hit the JWT plugin's /token endpoint with the cookie.
  const tokenRes = await fetch(`${baseUrl}/api/auth/token`, {
    headers: { Cookie: cookie, ...originHeaders },
  })
  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '')
    throw new Error(`/api/auth/token failed: ${tokenRes.status} ${body.slice(0, 200)}`)
  }
  const data = await tokenRes.json().catch(() => null)
  const token = data?.token
  if (!token) throw new Error(`/api/auth/token response missing "token": ${JSON.stringify(data).slice(0, 200)}`)
  return token
}

export function perfuserCommand(program) {
  program
    .command('perfuser')
    .description(
      'Create/refresh the synthetic perf user and emit a PERF_AUTH_TOKEN= line.\n' +
      '  Composes with: eval "$(um perfuser)" then node perf/perf-backend-p95.js'
    )
    .option('--backend-url <url>', 'Backend URL for token mint (default http://localhost:3000)', 'http://localhost:3000')
    .option('--origin <url>', 'Origin header for sign-in (must match backend trustedOrigins; default http://localhost:5173)', 'http://localhost:5173')
    .option('--info', 'Print user info instead of minting a token')
    .action(async (opts) => {
      const { created, user } = await ensurePerfUser()
      if (created) {
        ok(`Created perf user "${PERF_USERNAME}"`)
      } else {
        ok(`Perf user "${PERF_USERNAME}" already exists`)
      }
      console.error(`  email:    ${PERF_EMAIL}`)
      console.error(`  password: ${PERF_PASSWORD}`)
      console.error(`  userId:   ${user.id}`)

      if (opts.info) return

      let token
      try {
        token = await mintToken(opts.backendUrl, opts.origin)
      } catch (err) {
        fail(`token mint failed: ${err.message}\n  Backend at ${opts.backendUrl} reachable? For staging/prod, sign in manually and set PERF_AUTH_TOKEN=<jwt> directly.`)
      }

      // stdout is the shell-evalable line; everything else goes to stderr.
      process.stdout.write(`export PERF_AUTH_TOKEN='${token}'\n`)
    })
}
