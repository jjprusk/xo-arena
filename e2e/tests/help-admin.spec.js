// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Help System admin happy-path (Sprint 1 §1.11 + §1.6 + §1.7).
 *
 * Covers:
 *   1. Admin can land on /admin/help, sees the seeded corpus listed by category.
 *   2. Admin can click into a doc, edit the body, save, and reload — change persists.
 *   3. Admin can create a new doc via /admin/help/new, lands on the editor of
 *      the newly-created doc, and the doc appears in the list afterwards.
 *
 * Prerequisites:
 *   - Backend seeded the corpus on boot (8 PUBLISHED docs).
 *   - Landing dev server reachable at LANDING_URL (default http://localhost:5174).
 */

import { test, expect } from '@playwright/test'
import { runDbScript } from './dbScript.js'

const LANDING_URL = process.env.LANDING_URL || 'http://localhost:5174'
const SUBMIT_GUARD_MS = 3500

function freshEmail() {
  const ts = Date.now().toString(36)
  const r  = Math.random().toString(36).slice(2, 8)
  return `helpadm+${ts}-${r}@dev.local`
}

function uniqueName(label) {
  return `${label} ${Math.random().toString(36).slice(2, 8)}`
}

async function dismissWelcomeOnLoad(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('aiarena_guest_welcome_seen', '1') } catch {}
  })
}

/**
 * Closes the Guide drawer if it's open — it intercepts clicks on the
 * admin pages otherwise. Idempotent: silently passes if already closed.
 */
async function closeGuideIfOpen(page) {
  // The Guide renders both an orb (always visible) and a drawer (when
  // open). The drawer is what intercepts clicks on admin pages. Target
  // the dialog's explicit × close button rather than the orb.
  const dialogClose = page.locator('dialog[aria-label="Guide"] button', { hasText: '×' })
  if (await dialogClose.first().isVisible().catch(() => false)) {
    await dialogClose.first().click({ force: true }).catch(() => {})
    await page.waitForTimeout(300)
  }
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

/**
 * Promote the user with `email` to ADMIN (both BetterAuth role and a UserRole
 * row). Mirrors what `um role <email> ADMIN` does, since direct CLI access
 * isn't available from the e2e host without docker exec gymnastics.
 */
/**
 * Clears the cached session so the next render re-fetches and sees the
 * freshly-promoted role. The session cache lives in localStorage under
 * `aiarena_session_cache`; without clearing it, the guard will see the
 * pre-promotion role on initial render and bounce us home.
 */
async function clearSessionCache(page) {
  await page.evaluate(() => {
    try { window.localStorage.removeItem('aiarena_session_cache') } catch {}
  })
}

async function promoteToAdmin(email) {
  const result = runDbScript(`
    const baUser = await db.baUser.findUnique({ where: { email: ${JSON.stringify(email)} } })
    if (!baUser) throw new Error('baUser not found for ' + ${JSON.stringify(email)})
    const user = await db.user.findUnique({ where: { betterAuthId: baUser.id } })
    if (!user) throw new Error('domain user not found')
    await db.baUser.update({ where: { id: baUser.id }, data: { role: 'admin' } })
    await db.userRole.upsert({
      where:  { userId_role: { userId: user.id, role: 'ADMIN' } },
      create: { userId: user.id, role: 'ADMIN', grantedById: user.id },
      update: {},
    })
    process.stdout.write('PROMOTED ' + user.id)
  `, { tag: 'promote-admin' })
  if (!result.ok || !result.stdout.includes('PROMOTED')) {
    throw new Error(`promoteToAdmin failed: ${result.stderr || result.stdout}`)
  }
}

test.describe('Help admin', () => {
  test.setTimeout(90_000)

  test('admin sees seeded corpus, can edit a doc, change persists', async ({ page }) => {
    await dismissWelcomeOnLoad(page)
    const email    = freshEmail()
    const password = 'help-test-pw-1234'
    await signUp(page, { email, password, displayName: uniqueName('Help Admin') })
    await promoteToAdmin(email)
    await clearSessionCache(page)

    await page.goto(`${LANDING_URL}/admin/help`)
    await closeGuideIfOpen(page)
    // List header
    await expect(page.getByRole('heading', { name: /help docs/i })).toBeVisible()
    // At least one seeded doc visible — "Tournaments" is in the corpus.
    await expect(page.getByText('Tournaments').first()).toBeVisible({ timeout: 10_000 })

    // Open the tournaments doc. We navigate via the href rather than
    // clicking the Link, since the Guide drawer overlay reliably
    // intercepts pointer events on this admin shell.
    const href = await page.getByTestId('doc-row-tournaments').getAttribute('href')
    expect(href).toMatch(/\/admin\/help\/[^/]+$/)
    await page.goto(`${LANDING_URL}${href}`)
    await closeGuideIfOpen(page)

    // Editor renders
    await expect(page.getByText(/Edit help doc/i)).toBeVisible()
    const bodyTa = page.getByTestId('field-body')
    await expect(bodyTa).toBeVisible()

    // Append a sentinel and save
    const sentinel = `E2E_MARKER_${Date.now()}`
    const original = await bodyTa.inputValue()
    await bodyTa.fill(`${original}\n\n${sentinel}\n`)
    // Submit via Enter on the title field — works regardless of overlay
    // intercept since it goes through the form's keyboard handler.
    await page.getByTestId('field-title').focus()
    await page.keyboard.press('Enter')

    await expect(page.getByText('✓ Saved')).toBeVisible({ timeout: 15_000 })

    // Reload the page — the sentinel must still be in the body
    await page.reload()
    await closeGuideIfOpen(page)
    await expect(page.getByTestId('field-body')).toHaveValue(new RegExp(sentinel))

    // Cleanup: restore the body
    await page.getByTestId('field-body').fill(original)
    await page.getByTestId('field-title').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByText('✓ Saved')).toBeVisible({ timeout: 15_000 })
  })

  test('admin can create a new doc via /admin/help/new', async ({ page }) => {
    await dismissWelcomeOnLoad(page)
    const email    = freshEmail()
    const password = 'help-test-pw-1234'
    await signUp(page, { email, password, displayName: uniqueName('Help Author') })
    await promoteToAdmin(email)
    await clearSessionCache(page)

    const slug = `e2e-doc-${Date.now()}`
    await page.goto(`${LANDING_URL}/admin/help/new`)
    await closeGuideIfOpen(page)
    await expect(page.getByText('New help doc')).toBeVisible()

    await page.getByTestId('field-slug').fill(slug)
    await page.getByTestId('field-title').fill('E2E generated doc')
    await page.getByTestId('field-category').fill('e2e-test')
    await page.getByTestId('field-body').fill('# E2E doc\n\nBody for E2E.')
    await page.getByTestId('field-title').focus()
    await page.keyboard.press('Enter')

    // After create we navigate(`/admin/help/${doc.id}`) — confirm we're on
    // an edit page (not /new), slug shown read-only with our value, and
    // version 1.
    await expect(page).toHaveURL(/\/admin\/help\/[^/]+$/)
    await expect(page.getByText('Edit help doc')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('field-slug')).toHaveValue(slug)
    await expect(page.getByTestId('field-slug')).toBeDisabled()

    // Cleanup: archive the doc so it doesn't pollute future test runs.
    page.on('dialog', d => d.accept())
    await page.getByTestId('archive-button').click({ force: true })
    await expect(page).toHaveURL(/\/admin\/help$/, { timeout: 10_000 })
  })
})
