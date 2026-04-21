#!/usr/bin/env node
/**
 * QA Tournament Large — exercises HVH, MIXED, and BOT_VS_BOT tournament modes
 * with a large pool of QA bots (default: 20 per tournament).
 *
 * Usage:
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=secret node e2e/qa-tournament-large.mjs
 *
 * Optional env / CLI flags:
 *   BACKEND_URL    http://localhost:3000   (backend service)
 *   TOURNAMENT_URL http://localhost:3001   (tournament service)
 *   ADMIN_TOKEN    <jwt>                   skip sign-in (use pre-obtained token)
 *   --count N      bots per tournament (2–32, default 20)
 *   --timeout N    polling timeout in minutes (default 10)
 *   --cleanup      cancel + purge QA tournaments left from a previous run before starting
 *
 * What it does:
 *   1. Signs in as admin and obtains a JWT.
 *   2. Creates 3 single-elimination tournaments (HVH, MIXED, BOT_VS_BOT).
 *   3. Fills each with N QA bot accounts (qabot-01..qabot-N), creating them if needed.
 *   4. Publishes and starts each tournament.
 *   5. Polls every 10s until all matches complete or timeout.
 *   6. Reports per-tournament match completion and total elapsed time.
 */

import { createRequire } from 'node:module'

const BACKEND    = process.env.BACKEND_URL    || 'http://localhost:3000'
const TOURNAMENT = process.env.TOURNAMENT_URL || 'http://localhost:3001'

const args  = process.argv.slice(2)
const COUNT = Math.max(2, Math.min(32, Number(args[args.indexOf('--count') + 1]) || 20))
const TIMEOUT_MS = (Number(args[args.indexOf('--timeout') + 1]) || 10) * 60_000
const DO_CLEANUP = args.includes('--cleanup')
const POLL_MS = 10_000

const SCENARIOS = [
  { mode: 'HVH',        difficulty: 'novice',       label: 'HvH (all novice bots)' },
  { mode: 'MIXED',      difficulty: 'intermediate', label: 'Mixed (intermediate bots)' },
  { mode: 'BOT_VS_BOT', difficulty: 'advanced',     label: 'BvB (advanced bots)' },
]

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getToken() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN

  const email    = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) {
    throw new Error('Set ADMIN_EMAIL + ADMIN_PASSWORD (or ADMIN_TOKEN) to run this script.')
  }

  log('Signing in as admin...')
  const signInRes = await fetch(`${BACKEND}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!signInRes.ok) {
    const body = await signInRes.text().catch(() => '')
    throw new Error(`Sign-in failed (${signInRes.status}): ${body}`)
  }

  // Collect all Set-Cookie values (Node 18.14+ has getSetCookie, older has get)
  const rawCookies = typeof signInRes.headers.getSetCookie === 'function'
    ? signInRes.headers.getSetCookie()
    : (signInRes.headers.get('set-cookie') || '').split(/,(?=\s*\w+[=;])/)

  const cookieStr = rawCookies.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ')
  if (!cookieStr) throw new Error('Sign-in returned no session cookies.')

  const tokenRes = await fetch(`${BACKEND}/api/token`, { headers: { Cookie: cookieStr } })
  if (!tokenRes.ok) throw new Error(`Failed to fetch token (${tokenRes.status})`)
  const { token } = await tokenRes.json()
  if (!token) throw new Error('Server returned no token — admin credentials may be wrong.')
  log('Authenticated.')
  return token
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function tApi(method, path, body, token) {
  const res = await fetch(`${TOURNAMENT}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(`${method} ${path} → ${res.status}: ${err.error || res.statusText}`)
  }
  if (res.status === 204) return null
  return res.json()
}

const createTournament = (data, token) => tApi('POST', '/api/tournaments', data, token)
const publishTournament = (id, token) => tApi('POST', `/api/tournaments/${id}/publish`, {}, token)
const fillQaBots = (id, data, token) => tApi('POST', `/api/tournaments/${id}/fill-qa-bots`, data, token)
const startTournament = (id, token) => tApi('POST', `/api/tournaments/${id}/start`, {}, token)
const getTournament = (id, token) => tApi('GET', `/api/tournaments/${id}`, undefined, token)
const cancelTournament = (id, token) => tApi('POST', `/api/tournaments/${id}/cancel`, {}, token)
const purgeCancelled = (token) => tApi('DELETE', '/api/tournaments/admin/purge-cancelled', undefined, token)
const listTournaments = (params, token) => {
  const qs = new URLSearchParams(params).toString()
  return tApi('GET', `/api/tournaments${qs ? `?${qs}` : ''}`, undefined, token)
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

async function cleanupPreviousRun(token) {
  log('Cleanup: cancelling any existing QA Large tournaments...')
  let { tournaments } = await listTournaments({}, token)
  tournaments = (tournaments ?? []).filter(t => t.name.startsWith('QA Large'))
  const cancellable = ['DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS']
  let cancelled = 0
  for (const t of tournaments) {
    if (cancellable.includes(t.status)) {
      await cancelTournament(t.id, token).catch(e => warn(`Cancel ${t.name}: ${e.message}`))
      cancelled++
    }
  }
  const { deleted } = await purgeCancelled(token)
  log(`Cleanup: cancelled ${cancelled}, purged ${deleted} cancelled tournament(s).`)
}

// ── Progress polling ──────────────────────────────────────────────────────────

function countMatches(tournament) {
  let total = 0, completed = 0
  for (const round of tournament.rounds ?? []) {
    for (const m of round.matches ?? []) {
      total++
      if (m.status === 'COMPLETED') completed++
    }
  }
  return { total, completed }
}

async function pollAll(ids, token) {
  const start = Date.now()
  const done = new Set()

  log('\nPolling for match completion...')

  while (done.size < ids.length) {
    if (Date.now() - start > TIMEOUT_MS) {
      warn(`Timeout after ${TIMEOUT_MS / 60_000} min — some matches may still be pending.`)
      break
    }

    await new Promise(r => setTimeout(r, POLL_MS))

    for (const { id, label } of ids) {
      if (done.has(id)) continue
      try {
        const { tournament } = await getTournament(id, token)
        const { total, completed } = countMatches(tournament)
        const elapsed = ((Date.now() - start) / 1000).toFixed(0)

        if (tournament.status === 'COMPLETED' || (total > 0 && completed === total)) {
          log(`  [${elapsed}s] ${label}: DONE — ${completed}/${total} matches`)
          done.add(id)
        } else {
          log(`  [${elapsed}s] ${label}: ${completed}/${total} matches complete (status: ${tournament.status})`)
        }
      } catch (e) {
        warn(`Poll ${label}: ${e.message}`)
      }
    }
  }

  return { elapsed: Date.now() - start, completed: done.size, total: ids.length }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function log(msg)  { process.stdout.write(msg + '\n') }
function warn(msg) { process.stderr.write('[WARN] ' + msg + '\n') }

log(`\nQA Tournament Large — ${COUNT} bots × ${SCENARIOS.length} tournaments`)
log(`Backend: ${BACKEND}  |  Tournament: ${TOURNAMENT}\n`)

const token = await getToken().catch(e => { console.error(e.message); process.exit(1) })

if (DO_CLEANUP) await cleanupPreviousRun(token)

const created = []

for (const { mode, difficulty, label } of SCENARIOS) {
  log(`\n--- ${label} ---`)

  // Create
  const name = `QA Large ${mode} ${new Date().toISOString().slice(0, 10)}`
  log(`Creating tournament: ${name}`)
  const { tournament } = await createTournament({
    name,
    game:            'xo',
    mode,
    format:          'OPEN',
    bracketType:     'SINGLE_ELIM',
    bestOfN:         1,
    minParticipants: 2,
    maxParticipants: COUNT,
    startMode:       'MANUAL',
  }, token)
  log(`Created: ${tournament.id}`)

  // Publish
  await publishTournament(tournament.id, token)
  log('Published (registration open)')

  // Fill with QA bots
  const fill = await fillQaBots(tournament.id, { count: COUNT, difficulty }, token)
  log(`Registered: ${fill.registered.length} bots, skipped: ${fill.skipped.length}`)

  // Start
  await startTournament(tournament.id, token)
  log('Started — bracket generated, bot matches dispatched')

  created.push({ id: tournament.id, label: `${label} (${mode})` })
}

log('\nAll 3 tournaments started.')

const { elapsed, completed, total } = await pollAll(created, token)
const elapsedMin = (elapsed / 60_000).toFixed(1)

log(`\n========================================`)
log(`QA run complete: ${completed}/${total} tournaments finished`)
log(`Total time: ${elapsedMin} min`)
if (completed < total) {
  log('Some tournaments did not complete within the timeout — check logs and bot runner.')
}
