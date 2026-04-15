import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Smoke tests — run against staging after every promotion.
 *
 * Two-phase structure:
 *   Phase 1 — CI gate: polls GitHub Actions until "Deploy Staging" is done.
 *             Definitive success/failure — no timeout guessing.
 *   Phase 2 — Version check: confirms backend + landing serve the new version.
 *             Should be quick since Phase 1 already waited for the deploy.
 *
 * Run with:
 *   BACKEND_URL=https://xo-backend-staging.fly.dev \
 *   LANDING_URL=https://xo-landing-staging.fly.dev \
 *   TOURNAMENT_URL=https://xo-tournament-staging.fly.dev \
 *   npx playwright test smoke --project=chromium
 *
 * GITHUB_TOKEN is read from the environment or resolved via `gh auth token`.
 * Without it Phase 1 is skipped and Phase 2 falls back to longer polling.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const { version: EXPECTED_VERSION } = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf-8')
)

const BACKEND_URL    = process.env.BACKEND_URL    || 'http://localhost:3000'
const TOURNAMENT_URL = process.env.TOURNAMENT_URL || 'http://localhost:3001'
const LANDING_URL    = process.env.LANDING_URL    || 'http://localhost:5174'
const GITHUB_REPO    = 'jjprusk/xo-arena'

// Resolve token from env or gh CLI so callers don't need to export it manually.
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || (() => {
  try { return execSync('gh auth token', { encoding: 'utf8' }).trim() } catch { return null }
})()

// ── Phase 1: CI deploy gate ───────────────────────────────────────────────────

test('Phase 1 — Deploy Staging workflow completes on GitHub', async ({ request }) => {
  if (!GITHUB_TOKEN) {
    console.log('  ℹ No GitHub token available — skipping CI gate (Phase 1)')
    test.skip()
    return
  }

  test.setTimeout(30 * 60 * 1000) // 30 min hard cap — GitHub will always resolve before this
  const deadline = Date.now() + 28 * 60 * 1000

  const headers = {
    Authorization:         `Bearer ${GITHUB_TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }

  let run = null
  let conclusion = null

  console.log(`\n  Waiting for "Deploy Staging" on branch staging (v${EXPECTED_VERSION})…\n`)

  while (Date.now() < deadline) {
    try {
      const res = await request.get(
        `https://api.github.com/repos/${GITHUB_REPO}/actions/runs?branch=staging&per_page=10`,
        { headers }
      )
      if (res.ok()) {
        const { workflow_runs } = await res.json()
        // Most recent "Deploy Staging" run — always the one just triggered by the merge.
        run = workflow_runs.find(r => r.name === 'Deploy Staging')
        if (run?.status === 'completed') {
          conclusion = run.conclusion
          break
        }
        if (run) console.log(`  Deploy Staging: ${run.status}…`)
        else     console.log('  Deploy Staging: run not yet visible…')
      }
    } catch { /* network hiccup — retry */ }
    await new Promise(r => setTimeout(r, 15_000)) // poll every 15s
  }

  const url = run?.html_url ?? `https://github.com/${GITHUB_REPO}/actions`
  console.log(`\n  Deploy Staging: ${conclusion ?? 'timed out'} — ${url}\n`)

  expect(conclusion, `Deploy Staging timed out — check ${url}`).not.toBeNull()
  expect(conclusion, `Deploy Staging failed — see ${url}`).toBe('success')

  console.log('  ✓ Deploy Staging succeeded\n')
})

// ── Phase 2: Version confirmation ─────────────────────────────────────────────
// Deploy is already confirmed by Phase 1, so this should resolve quickly.
// If Phase 1 was skipped (no token), we poll longer as a fallback.

test('Phase 2 — backend and landing serve the expected version', async ({ request }) => {
  const fallbackMode = !GITHUB_TOKEN
  const pollMinutes  = fallbackMode ? 12 : 3
  test.setTimeout((pollMinutes + 1) * 60 * 1000)
  const deadline = Date.now() + pollMinutes * 60 * 1000

  if (fallbackMode) {
    console.log(`\n  ℹ No GitHub token — polling version directly for up to ${pollMinutes} min\n`)
  } else {
    console.log(`\n  Confirming version (up to ${pollMinutes} min)…\n`)
  }

  let backendDeployed = null
  let landingDeployed  = null

  while (Date.now() < deadline) {
    try {
      if (!backendDeployed) {
        const res = await request.get(`${BACKEND_URL}/api/version`)
        if (res.ok()) {
          const { version } = await res.json()
          if (version === EXPECTED_VERSION) backendDeployed = version
          else console.log(`  backend: v${version} (waiting for v${EXPECTED_VERSION}…)`)
        }
      }
      if (!landingDeployed) {
        const res = await request.get(`${LANDING_URL}/landing-version`)
        if (res.ok()) {
          const { version } = await res.json()
          if (version === EXPECTED_VERSION) landingDeployed = version
          else console.log(`  landing: v${version} (waiting for v${EXPECTED_VERSION}…)`)
        }
      }
      if (backendDeployed && landingDeployed) break
    } catch { /* services not yet responding */ }
    await new Promise(r => setTimeout(r, 10_000))
  }

  console.log(`\n  backend : ${backendDeployed ? `✓ v${backendDeployed}` : '✗ timed out (still on old version)'}`)
  console.log(`  landing : ${landingDeployed  ? `✓ v${landingDeployed}`  : '✗ timed out (still on old version)'}\n`)

  expect(backendDeployed, `Backend not at v${EXPECTED_VERSION} after deploy`).toBe(EXPECTED_VERSION)
  expect(landingDeployed,  `Landing not at v${EXPECTED_VERSION} after deploy`).toBe(EXPECTED_VERSION)

  console.log(`✓ Deployed version: v${backendDeployed} (backend + landing)\n`)
  test.info().annotations.push({ type: 'Deployed version', description: `v${backendDeployed}` })
})

// ── Frontend smoke ────────────────────────────────────────────────────────────

test.describe('Smoke — frontend', () => {
  test('home page loads and shows AI Arena branding', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/AI Arena/i)
  })

  test('sign-in modal can be opened', async ({ page }) => {
    await page.goto(LANDING_URL)
    // Fresh browser has empty localStorage, so the guest welcome modal always appears.
    // Its "Sign in" button opens the auth form directly.
    const welcomeSignIn = page.getByRole('dialog').getByRole('button', { name: /sign in/i })
    await welcomeSignIn.waitFor({ state: 'visible', timeout: 10_000 })
    await welcomeSignIn.click()
    await expect(page.locator('input[autocomplete="email"]')).toBeVisible({ timeout: 15_000 })
  })

  test('rankings page loads without auth', async ({ page }) => {
    // Phase 2.2 renamed /leaderboard → /rankings (and the page header).
    await page.goto('/rankings')
    await expect(page.getByRole('heading', { name: /rankings/i })).toBeVisible()
  })

  test('tournaments page loads and shows filter bar', async ({ page }) => {
    await page.goto(`${LANDING_URL}/tournaments`)
    await expect(page.getByRole('heading', { name: /tournaments/i })).toBeVisible()
    // Filter bar buttons: All, Open, In Progress, Completed
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open' })).toBeVisible()
  })

})

// ── Backend API smoke ─────────────────────────────────────────────────────────

test.describe('Smoke — backend API', () => {
  test('/api/version returns expected version', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/version`)
    expect(res.ok()).toBe(true)
    const { version } = await res.json()
    expect(version).toBe(EXPECTED_VERSION)
  })

  test('auth session endpoint responds (not 500)', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/auth/get-session`)
    expect(res.status()).not.toBe(500)
  })

  test('feedback submit endpoint exists (not 404)', async ({ request }) => {
    const res = await request.post(`${BACKEND_URL}/api/v1/feedback`, { data: {} })
    expect(res.status()).not.toBe(404)
  })

  test('tournament list endpoint is reachable', async ({ request }) => {
    const res = await request.get(`${TOURNAMENT_URL}/api/tournaments`)
    expect(res.ok()).toBe(true)
    const body = await res.json()
    // May be an array or { tournaments: [] } — either way it must be an object/array
    expect(typeof body === 'object' && body !== null).toBe(true)
  })

  test('tournament registration requires auth (401, not 404)', async ({ request }) => {
    // Confirm the register endpoint is mounted — unauthenticated POST should 401, not 404
    const res = await request.post(`${TOURNAMENT_URL}/api/tournaments/smoke-check/register`, { data: {} })
    expect(res.status()).toBe(401)
  })

  test('GET /classification/me requires auth (401, not 404)', async ({ request }) => {
    // Confirms classificationMeRouter is mounted and requireAuth fires
    const res = await request.get(`${TOURNAMENT_URL}/api/classification/me`)
    expect(res.status()).toBe(401)
  })
})
