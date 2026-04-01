import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Smoke tests — run against BASE_URL after every production promotion.
 *
 * Polls /api/version until the expected version is live (up to 3 min),
 * then verifies key surfaces load and reports the deployed version.
 *
 * Run with:
 *   BASE_URL=https://xo.aiarena.callidity.com npx playwright test smoke --project=chromium
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const { version: EXPECTED_VERSION } = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf-8')
)

// ── Wait for deploy ───────────────────────────────────────────────────────────

test('wait for deploy — /api/version matches expected version', async ({ request }) => {
  test.setTimeout(4 * 60 * 1000) // 4 min — overrides global 30s for this polling test
  const deadline = Date.now() + 3 * 60 * 1000 // 3 minutes
  let deployed = null

  while (Date.now() < deadline) {
    try {
      const res = await request.get('/api/version')
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
    await page.getByRole('button', { name: /sign in/i }).first().click()
    await expect(page.locator('input[type="email"]')).toBeVisible()
  })

  test('leaderboard page loads without auth', async ({ page }) => {
    await page.goto('/leaderboard')
    await expect(page.getByRole('heading', { name: /leaderboard/i })).toBeVisible()
  })

  test('about page shows correct version', async ({ page }) => {
    await page.goto('/about')
    await expect(page.locator('span.font-mono')).toContainText(`v${EXPECTED_VERSION}`)
  })
})

// ── Backend API smoke ─────────────────────────────────────────────────────────

test.describe('Smoke — backend API', () => {
  test('/api/version returns expected version', async ({ request }) => {
    const res = await request.get('/api/version')
    expect(res.ok()).toBe(true)
    const { version } = await res.json()
    expect(version).toBe(EXPECTED_VERSION)
  })

  test('auth session endpoint responds (not 500)', async ({ request }) => {
    const res = await request.get('/api/auth/get-session')
    expect(res.status()).not.toBe(500)
  })

  test('feedback submit endpoint exists (not 404)', async ({ request }) => {
    const res = await request.post('/api/v1/feedback', { data: {} })
    expect(res.status()).not.toBe(404)
  })
})
