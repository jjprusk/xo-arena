// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Help System — end-to-end happy path (Sprint 3 §3.8).
 *
 * Two scenarios bundled here:
 *
 *   1. Guide drawer round-trip — sign up a fresh user, open the Guide,
 *      ask a corpus-grounded question, see the streamed answer, and
 *      submit thumbs-up feedback. We don't pin specific answer wording
 *      because the real `gpt-4o-mini` response varies; we DO verify that
 *      the answer body landed and the feedback "Thanks…" flash appears.
 *
 *   2. Public browse pages — navigate to `/help`, see the category-
 *      grouped index, click into a known doc, see the doc body render.
 *      Works without auth (a fresh page context, no sign-in).
 *
 * Why this is bundled (rather than 1-test-per-spec-bullet): a full
 * thumbs-up → thumbs-down → category → flip-back rotation against real
 * gpt-4o-mini takes ~30+ seconds per ask. The happy-path scenarios
 * cover the wire-up; the granular thumb/category behaviour is unit-
 * tested in HelpFeedback.test.jsx (13 cases) and helpService.test.js
 * + help.test.js. This file is the smoke that proves it all wires
 * together against real services.
 *
 * Prerequisites:
 *   Frontend  : http://localhost:5174 (landing)
 *   Backend   : http://localhost:3000 with OPENAI_API_KEY in env
 */

import { test, expect } from '@playwright/test'

const LANDING_URL = process.env.LANDING_URL || 'http://localhost:5174'

// SignInModal anti-bot 3-second guard.
const SUBMIT_GUARD_MS = 3500

function freshEmail() {
  const ts = Date.now().toString(36)
  const r  = Math.random().toString(36).slice(2, 8)
  return `help+${ts}-${r}@dev.local`
}

function uniqueName(label) {
  return `${label} ${Math.random().toString(36).slice(2, 8)}`
}

async function dismissWelcomeOnLoad(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('aiarena_guest_welcome_seen', '1') } catch {}
  })
}

async function signUp(page, { email, password, displayName }) {
  await page.goto('/')
  await page.getByRole('button', { name: /build your own bot/i }).click()
  await expect(page.getByRole('heading', { name: /build your first bot/i })).toBeVisible()
  await page.getByPlaceholder(/^display name$/i).fill(displayName)
  await page.getByPlaceholder(/^email$/i).fill(email)
  await page.getByPlaceholder(/min\. 8/i).fill(password)
  await page.getByPlaceholder(/confirm password/i).fill(password)
  await page.waitForTimeout(SUBMIT_GUARD_MS)
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page.getByRole('heading', { name: /build your first bot/i }))
    .toBeHidden({ timeout: 10_000 })
}

test.describe('Help System — Guide drawer end-to-end (§3.8)', () => {
  test.setTimeout(120_000)  // OpenAI streaming + signup adds overhead

  test('signed-up user can ask the Guide a question, see streamed answer, and thumbs-up', async ({ page }) => {
    await dismissWelcomeOnLoad(page)
    const email    = freshEmail()
    const password = 'help-test-pw-1234'
    await signUp(page, { email, password, displayName: uniqueName('Help E2E') })

    // The Guide drawer auto-opens for signed-in users (per the existing
    // guideAutoOpen behaviour). If it isn't open, fall back to clicking
    // the orb in the header.
    const helpInput = page.getByLabel(/Ask the Guide a question/i)
    if (!(await helpInput.isVisible().catch(() => false))) {
      // The Guide orb is the 🤖 button in the header.
      await page.locator('button[aria-label*="Guide" i]').first().click()
      await expect(helpInput).toBeVisible({ timeout: 5_000 })
    }

    // Ask a corpus-grounded question.
    await helpInput.fill('How do I get started?')
    await helpInput.press('Enter')

    // The turn appears with the question text. We don't pin the exact
    // model output — just that an answer body lands (the "Thinking…"
    // placeholder is replaced by streamed tokens).
    await expect(page.getByText('How do I get started?', { exact: false })).toBeVisible({ timeout: 5_000 })
    // Wait for HelpFeedback to mount — it only renders when the turn
    // reaches `done` status with a real queryId/answerId.
    await expect(page.getByTestId('help-feedback')).toBeVisible({ timeout: 60_000 })

    // Thumbs-up.
    await page.getByTestId('thumb-up').click()
    await expect(page.getByTestId('thumb-up')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('thanks-flash')).toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Help System — public browse pages (§3.7 / §3.8)', () => {
  test.setTimeout(30_000)

  test('anonymous visitor can browse /help and read a single doc', async ({ page }) => {
    // No sign-in — public surface must work for guests.
    await page.goto('/help')
    // Header.
    await expect(page.getByRole('heading', { name: /^Help$/ })).toBeVisible({ timeout: 10_000 })
    // At least one category section renders (seeded corpus has 'basics').
    await expect(page.getByText(/Getting started$/i)).toBeVisible()

    // Click a known doc — getting-started is the canonical onboarding doc
    // and is part of the seeded corpus.
    const gsLink = page.getByRole('link', { name: /^Getting started with AI Arena$/i })
    await expect(gsLink).toBeVisible()
    await gsLink.click()

    // Doc page renders.
    await expect(page).toHaveURL(/\/help\/getting-started/)
    await expect(page.getByTestId('help-doc-page')).toBeVisible()
    // The body contains the doc's H1 (rendered as <h1> by react-markdown).
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // Back link.
    await expect(page.getByRole('link', { name: /Help index/i })).toBeVisible()
  })

  test('unknown slug renders a friendly 404 view', async ({ page }) => {
    await page.goto('/help/this-slug-does-not-exist-9999')
    await expect(page.getByText(/Doc not found/i)).toBeVisible({ timeout: 10_000 })
    // Back link to /help is offered (the header "← Help index" link, not
    // the inline body link).
    await expect(page.getByRole('link', { name: '← Help index' })).toBeVisible()
  })
})
