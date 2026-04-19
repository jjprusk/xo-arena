import { test, expect } from '@playwright/test'
import { signIn } from './helpers.js'

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
    await page.goto(`${LANDING_URL}/tables`)
    await expect(page.getByRole('columnheader', { name: /game/i })).toBeVisible()
  })
})

// ─── Part 3: Bot creation game field — requires user auth ─────────────────────

test.describe('Phase 3.5 — bot creation game field', () => {
  test('bot creation panel has a Game dropdown with XO option', async ({ page }) => {
    test.skip(!process.env.TEST_USER_EMAIL, 'Set TEST_USER_EMAIL + TEST_USER_PASSWORD to enable')

    await signIn(page, process.env.TEST_USER_EMAIL, process.env.TEST_USER_PASSWORD, BACKEND_URL)
    await page.goto(`${LANDING_URL}/profile?section=bots`)

    // Open the create-bot panel
    await page.getByRole('button', { name: /create bot|new bot/i }).first().click()

    // Game dropdown should be visible
    const gameSelect = page.locator('select').filter({
      has: page.locator('option[value="xo"]'),
    })
    await expect(gameSelect).toBeVisible({ timeout: 5_000 })
    await expect(gameSelect.locator('option[value="xo"]')).toHaveText(/XO/i)
  })
})

// ─── Part 4: Mobile sidebar auto-hide — requires user auth ────────────────────

test.describe('Phase 3.5 — mobile sidebar auto-hide', () => {
  test('sidebar is hidden automatically on mobile when game starts', async ({ page }) => {
    test.skip(!process.env.TEST_USER_EMAIL, 'Set TEST_USER_EMAIL + TEST_USER_PASSWORD to enable')

    await page.setViewportSize({ width: 375, height: 667 })
    await signIn(page, process.env.TEST_USER_EMAIL, process.env.TEST_USER_PASSWORD, BACKEND_URL)

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
    await signIn(page, process.env.TEST_USER_EMAIL, process.env.TEST_USER_PASSWORD, BACKEND_URL)
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

    await signIn(page, process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD, BACKEND_URL)
    await page.goto(`${LANDING_URL}/admin/bots`)

    await expect(page.getByRole('columnheader', { name: /skills/i })).toBeVisible({ timeout: 8_000 })
  })

  test('admin bots API returns skills array per bot', async ({ request }) => {
    test.skip(!process.env.TEST_ADMIN_EMAIL, 'Set TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD to enable')

    // Sign in via API to get a token for the request context
    const loginRes = await request.post(`${BACKEND_URL}/api/auth/sign-in/email`, {
      data: { email: process.env.TEST_ADMIN_EMAIL, password: process.env.TEST_ADMIN_PASSWORD },
    })
    expect(loginRes.ok()).toBe(true)

    const botsRes = await request.get(`${BACKEND_URL}/api/v1/admin/bots`)
    expect(botsRes.ok()).toBe(true)
    const { bots } = await botsRes.json()
    // Every bot row must have a skills array
    for (const bot of bots) {
      expect(Array.isArray(bot.skills)).toBe(true)
    }
  })
})
