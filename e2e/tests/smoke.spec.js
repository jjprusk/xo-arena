import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Smoke tests — run against BASE_URL after every production promotion.
 *
 * Polls /api/version until the expected version is live (up to 5 min),
 * then verifies key surfaces load and reports the deployed version.
 *
 * Run with:
 *   BASE_URL=https://xo-frontend-staging.fly.dev \
 *   BACKEND_URL=https://xo-backend-staging.fly.dev \
 *   npx playwright test smoke --project=chromium
 *
 * BACKEND_URL defaults to BASE_URL when running locally (Vite proxies /api/).
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const { version: EXPECTED_VERSION } = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf-8')
)

const BACKEND_URL    = process.env.BACKEND_URL    || process.env.BASE_URL || 'http://localhost:3000'
const TOURNAMENT_URL = process.env.TOURNAMENT_URL || 'http://localhost:3001'

// ── Wait for deploy ───────────────────────────────────────────────────────────

test('wait for deploy — /api/version matches expected version', async ({ request }) => {
  test.setTimeout(6 * 60 * 1000) // 6 min — overrides global 30s for this polling test
  const deadline = Date.now() + 5 * 60 * 1000 // 5 minutes
  let deployed = null

  while (Date.now() < deadline) {
    try {
      const res = await request.get(`${BACKEND_URL}/api/version`)
      if (res.ok()) {
        const { version } = await res.json()
        if (version === EXPECTED_VERSION) {
          deployed = version
          break
        }
        console.log(`  still on v${version}, waiting for v${EXPECTED_VERSION}…`)
      }
    } catch { /* backend not yet up */ }
    await new Promise(r => setTimeout(r, 10_000)) // poll every 10s
  }

  expect(deployed, `Timed out waiting for v${EXPECTED_VERSION} to deploy`).toBe(EXPECTED_VERSION)
  console.log(`\n✓ Deployed version: v${deployed}\n`)
  test.info().annotations.push({ type: 'Deployed version', description: `v${deployed}` })
})

// ── Frontend smoke ────────────────────────────────────────────────────────────

test.describe('Smoke — frontend', () => {
  test('home page loads and shows XO Arena branding', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/XO Arena/i)
  })

  test('sign-in modal can be opened', async ({ page }) => {
    await page.goto('/')
    const signInBtn = page.getByRole('button', { name: /sign in/i }).first()
    await signInBtn.waitFor({ state: 'visible', timeout: 10_000 })
    await signInBtn.click()
    await expect(page.locator('input[autocomplete="email"]')).toBeVisible({ timeout: 15_000 })
  })

  test('leaderboard page loads without auth', async ({ page }) => {
    await page.goto('/leaderboard')
    await expect(page.getByRole('heading', { name: /leaderboard/i })).toBeVisible()
  })

  test('tournaments page loads and shows filter bar', async ({ page }) => {
    await page.goto('/tournaments')
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
