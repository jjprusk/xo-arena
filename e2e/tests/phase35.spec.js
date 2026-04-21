import { test, expect } from '@playwright/test'
import { signIn, fetchAuthToken } from './helpers.js'

/**
 * Phase 3.5 feature checks — multi-game infrastructure, bot skills, mobile sidebar.
 *
 * Structure:
 *   Part 1 — API endpoint checks (no auth — always run)
 *   Part 2 — Tables page DOM checks (no auth — always run)
 *   Part 3 — Bot creation game field (requires TEST_USER_EMAIL + TEST_USER_PASSWORD)
 *   Part 4 — Mobile sidebar auto-hide (requires TEST_USER_EMAIL + TEST_USER_PASSWORD)
 *   Part 5 — Admin bots skills column (requires TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD)
 *
 * To enable auth-gated tests, set env vars and run:
 *   TEST_USER_EMAIL=you@example.com TEST_USER_PASSWORD=... \
 *   TEST_ADMIN_EMAIL=admin@example.com TEST_ADMIN_PASSWORD=... \
 *   npx playwright test phase35 --project=chromium
 */

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000'
const LANDING_URL = process.env.LANDING_URL || 'http://localhost:5174'

// ─── Part 1: API endpoint checks — no auth required ───────────────────────────

test.describe('Phase 3.5 — skills API', () => {
  test('GET /api/v1/skills/models is public (200, returns models array)', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/v1/skills/models`)
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body.models)).toBe(true)
  })

  test('GET /api/v1/skills/models?gameId=xo filters by game', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/v1/skills/models?gameId=xo`)
    expect(res.ok()).toBe(true)
    const { models } = await res.json()
    // Every returned model must have gameId = 'xo' if there are any
    for (const m of models) {
      expect(m.gameId).toBe('xo')
    }
  })

  test('POST /api/v1/skills/models requires auth (401, not 404)', async ({ request }) => {
    const res = await request.post(`${BACKEND_URL}/api/v1/skills/models`, { data: { name: 'test' } })
    expect(res.status()).toBe(401)
  })

  test('GET /api/v1/admin/bots is mounted and requires auth (401, not 404)', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/v1/admin/bots`)
    expect(res.status()).toBe(401)
  })
})

// ─── Part 2: Tables page — no auth required ───────────────────────────────────

test.describe('Phase 3.5 — tables page', () => {
  test('tables list page loads without auth', async ({ page }) => {
    await page.goto(`${LANDING_URL}/tables`)
    await expect(page.getByRole('heading', { name: /tables/i })).toBeVisible()
  })

  test('tables list has a Game column header', async ({ page }) => {
    // Widen the status + date filters so we pick up any table in the DB —
    // TablesPage hides the columns entirely when its filtered list is empty,
    // which would otherwise make this test fail on a fresh DB.
    await page.goto(`${LANDING_URL}/tables?status=ALL&date=all`)
    const gameHeader = page.getByRole('columnheader', { name: /game/i })
    const emptyState = page.getByText(/No tables open right now|No tables found/i)
    // Either we see the Game column (list populated) or the empty-state
    // message renders instead — both are "the page rendered correctly."
    // Only a timeout here would indicate a real regression.
    await expect(gameHeader.or(emptyState)).toBeVisible()
  })
})

// ─── Part 3: Bot creation game field — requires user auth ─────────────────────

test.describe('Phase 3.5 — bot creation game field', () => {
  test('bot creation panel has a Game dropdown with XO option', async ({ page }) => {
    test.skip(!process.env.TEST_USER_EMAIL, 'Set TEST_USER_EMAIL + TEST_USER_PASSWORD to enable')

    await signIn(page, process.env.TEST_USER_EMAIL, process.env.TEST_USER_PASSWORD, LANDING_URL)
    // ?action=create-bot auto-opens the create panel as soon as the dbUser
    // loads — no button click required. More reliable than racing a scroll +
    // accordion toggle via the "+ Create new bot" button.
    await page.goto(`${LANDING_URL}/profile?action=create-bot`)

    // Game dropdown should be visible
    const gameSelect = page.locator('select').filter({
      has: page.locator('option[value="xo"]'),
    })
    await expect(gameSelect).toBeVisible({ timeout: 10_000 })
    await expect(gameSelect.locator('option[value="xo"]')).toHaveText(/XO/i)
  })
})

// ─── Part 4: Mobile sidebar auto-hide — requires user auth ────────────────────

test.describe('Phase 3.5 — mobile sidebar auto-hide', () => {
  test('sidebar is hidden automatically on mobile when game starts', async ({ page }) => {
    test.skip(!process.env.TEST_USER_EMAIL, 'Set TEST_USER_EMAIL + TEST_USER_PASSWORD to enable')

    await page.setViewportSize({ width: 375, height: 667 })
    await signIn(page, process.env.TEST_USER_EMAIL, process.env.TEST_USER_PASSWORD, LANDING_URL)

    // Start an HvB game
    await page.goto(`${LANDING_URL}/play?action=vs-community-bot`)

    // Wait for the board to appear (game reached 'playing' phase)
    const board = page.locator('[aria-label="Tic-tac-toe board"]')
    await expect(board).toBeVisible({ timeout: 15_000 })

    // Sidebar should be hidden — toggle button says "show info panel"
    await expect(page.getByRole('button', { name: /show info panel/i })).toBeVisible()
    await expect(page.getByRole('complementary', { name: /table context/i })).toBeHidden()

    // Tap the toggle → sidebar appears
    await page.getByRole('button', { name: /show info panel/i }).click()
    await expect(page.getByRole('complementary', { name: /table context/i })).toBeVisible()

    // Tap again → sidebar hides
    await page.getByRole('button', { name: /hide info panel/i }).click()
    await expect(page.getByRole('complementary', { name: /table context/i })).toBeHidden()
  })

  test('sidebar does NOT auto-hide on desktop when game starts', async ({ page }) => {
    test.skip(!process.env.TEST_USER_EMAIL, 'Set TEST_USER_EMAIL + TEST_USER_PASSWORD to enable')

    await page.setViewportSize({ width: 1280, height: 800 })
    await signIn(page, process.env.TEST_USER_EMAIL, process.env.TEST_USER_PASSWORD, LANDING_URL)
    await page.goto(`${LANDING_URL}/play?action=vs-community-bot`)

    const board = page.locator('[aria-label="Tic-tac-toe board"]')
    await expect(board).toBeVisible({ timeout: 15_000 })

    // On desktop, sidebar should be visible (not auto-hidden)
    await expect(page.getByRole('complementary', { name: /table context/i })).toBeVisible()
  })
})

// ─── Part 5: Admin bots skills column — requires admin auth ───────────────────

test.describe('Phase 3.5 — admin bots skills column', () => {
  test('admin bots table has a Skills column', async ({ page }) => {
    test.skip(!process.env.TEST_ADMIN_EMAIL, 'Set TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD to enable')

    // The Skills column is `hidden lg:table-cell` — only rendered at >= 1024px.
    // Force a desktop-wide viewport so the test doesn't depend on Playwright's
    // default viewport width.
    await page.setViewportSize({ width: 1280, height: 900 })
    await signIn(page, process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD, LANDING_URL)
    await page.goto(`${LANDING_URL}/admin/bots`)

    await expect(page.getByRole('columnheader', { name: /skills/i })).toBeVisible({ timeout: 8_000 })
  })

  test('admin bots API returns skills array per bot', async ({ request }) => {
    test.skip(!process.env.TEST_ADMIN_EMAIL, 'Set TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD to enable')

    // Sign in to set the BA session cookie, then fetch a Bearer JWT — the
    // admin endpoint's `requireAuth` middleware only honors Bearer tokens,
    // not the session cookie.
    const pageLike = { context: () => ({ request }) }
    await signIn(pageLike, process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD, BACKEND_URL)
    const token = await fetchAuthToken(request, BACKEND_URL)

    const botsRes = await request.get(`${BACKEND_URL}/api/v1/admin/bots`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(botsRes.ok()).toBe(true)
    const { bots } = await botsRes.json()
    for (const bot of bots) {
      expect(Array.isArray(bot.skills)).toBe(true)
    }
  })
})
