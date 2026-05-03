import { test, expect, request as playwrightRequest } from '@playwright/test'
import { signIn, fetchAuthToken, createGuestTable } from './helpers.js'

/**
 * E2E-02: Full PvP game flow
 * E2E-03: Spectator flow
 *
 * Phase 3.4 removed the `/play` auto-room / "Invite a Friend" flow — Tables
 * are now the only game-session primitive and Table creation requires auth.
 * These tests sign in two distinct accounts (host + guest) via the setup
 * script's qa-user / qa-user-2 and create a Table via REST, then both users
 * navigate to the share URL. Spectator flows use a third authed context
 * because the old anonymous-spectator path also went away with auto-rooms.
 *
 * Requires TEST_USER_EMAIL/PASSWORD and TEST_USER2_EMAIL/PASSWORD in qa.env.
 */

const LANDING_URL = process.env.LANDING_URL || 'http://localhost:5174'
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000'

const haveUsers = !!process.env.TEST_USER_EMAIL && !!process.env.TEST_USER2_EMAIL

const boardLocator = (page) => page.locator('[aria-label="Tic-tac-toe board"]')
const emptyCells = (page) => page.locator('button[aria-label^="Cell "]:not([disabled])')

/**
 * Sign both pages in, create a Table via REST as user A, return its share URL.
 * The two pages end up as independent authenticated sessions on the same
 * Table — the actual seat-taking happens when each navigates to the invite
 * URL and useGameSDK emits `room:join`.
 */
async function setupHostAndGuest(browser) {
  const hostCtx  = await browser.newContext()
  const guestCtx = await browser.newContext()
  const hostPage  = await hostCtx.newPage()
  const guestPage = await guestCtx.newPage()

  await signIn(hostPage,  process.env.TEST_USER_EMAIL,  process.env.TEST_USER_PASSWORD,  LANDING_URL)
  await signIn(guestPage, process.env.TEST_USER2_EMAIL, process.env.TEST_USER2_PASSWORD, LANDING_URL)

  const hostToken = await fetchAuthToken(hostCtx.request, LANDING_URL)
  const { slug, inviteUrl } = await createGuestTable(hostCtx.request, hostToken, LANDING_URL)

  return { hostCtx, guestCtx, hostPage, guestPage, slug, inviteUrl }
}

test.describe('PvP game flow', () => {
  test.setTimeout(60_000)

  test('host + guest both land on the board via the share URL', async ({ browser }) => {
    test.skip(!haveUsers, 'Set TEST_USER_EMAIL + TEST_USER2_EMAIL + passwords in qa.env')

    const { hostCtx, guestCtx, hostPage, guestPage, inviteUrl } = await setupHostAndGuest(browser)
    try {
      expect(inviteUrl).toMatch(/\/play\?join=mt-/)

      // Both parties land on the game board via the share URL. The order
      // matters: the host's page navigates first and takes seat 1, then the
      // guest lands and takes seat 2 — same as clicking the share link.
      await hostPage.goto(inviteUrl)
      await guestPage.goto(inviteUrl)

      await expect(boardLocator(hostPage)).toBeVisible({ timeout: 15_000 })
      await expect(boardLocator(guestPage)).toBeVisible({ timeout: 15_000 })

      // Exactly one side is on-turn once both are seated.
      const hostTurn  = await hostPage.getByText('Your turn').isVisible().catch(() => false)
      const guestTurn = await guestPage.getByText('Your turn').isVisible().catch(() => false)
      expect(hostTurn || guestTurn).toBe(true)
      expect(hostTurn && guestTurn).toBe(false)
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('players make moves and the game reaches a conclusion', async ({ browser }) => {
    test.skip(!haveUsers, 'Set TEST_USER_EMAIL + TEST_USER2_EMAIL + passwords in qa.env')

    const { hostCtx, guestCtx, hostPage, guestPage, inviteUrl } = await setupHostAndGuest(browser)
    try {
      await hostPage.goto(inviteUrl)
      await guestPage.goto(inviteUrl)
      await expect(boardLocator(hostPage)).toBeVisible({ timeout: 15_000 })
      await expect(boardLocator(guestPage)).toBeVisible({ timeout: 15_000 })

      const pages = [hostPage, guestPage]
      const endTexts = ['You win', 'Opponent wins', 'Draw']

      for (let move = 0; move < 9; move++) {
        let activePage = null
        for (const p of pages) {
          if (await p.getByText('Your turn').isVisible().catch(() => false)) { activePage = p; break }
        }
        if (!activePage) {
          await hostPage.waitForTimeout(500)
          for (const p of pages) {
            if (await p.getByText('Your turn').isVisible().catch(() => false)) { activePage = p; break }
          }
        }
        if (!activePage) break
        const cells = emptyCells(activePage)
        if (await cells.count() === 0) break
        await cells.first().click()
        await hostPage.waitForTimeout(400)

        let ended = false
        for (const p of pages) {
          for (const txt of endTexts) {
            if (await p.getByText(txt, { exact: false }).isVisible().catch(() => false)) { ended = true; break }
          }
          if (ended) break
        }
        if (ended) break
      }

      for (const p of pages) {
        await expect(p.getByRole('button', { name: 'Rematch' })).toBeVisible({ timeout: 5_000 })
      }
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  // Dropped: "table display name is shown on the board" — the Tables paradigm
  // no longer renders a curated mountain name anywhere on the game surface;
  // labels are now computed on read from seats + tournament context (see
  // backend/src/lib/tableLabel.js).
})

test.describe('Spectator flow', () => {
  test.setTimeout(60_000)

  test('spectator can join an active game and see moves', async ({ browser }) => {
    test.skip(!haveUsers, 'Set TEST_USER_EMAIL + TEST_USER2_EMAIL + passwords in qa.env')
    // Use the admin account as the spectator — any authed account works; we
    // just need a third distinct session. Skip if admin creds aren't set.
    test.skip(!process.env.TEST_ADMIN_EMAIL, 'Also set TEST_ADMIN_EMAIL to run spectator tests')

    const { hostCtx, guestCtx, hostPage, guestPage, inviteUrl } = await setupHostAndGuest(browser)
    const spectatorCtx  = await browser.newContext()
    const spectatorPage = await spectatorCtx.newPage()

    try {
      await signIn(spectatorPage, process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD, LANDING_URL)

      await hostPage.goto(inviteUrl)
      await guestPage.goto(inviteUrl)
      await expect(boardLocator(hostPage)).toBeVisible({ timeout: 15_000 })
      await expect(boardLocator(guestPage)).toBeVisible({ timeout: 15_000 })

      // Third party hits the same URL after seats are full → spectator.
      await spectatorPage.goto(inviteUrl)
      await expect(boardLocator(spectatorPage)).toBeVisible({ timeout: 10_000 })
      await expect(spectatorPage.getByText('Spectating')).toBeVisible()

      const spectatorCells = spectatorPage.locator('button[aria-label^="Cell "]:not([disabled])')
      expect(await spectatorCells.count()).toBe(0)

      // Watcher count surfaces in the sidebar as "N watching". PlatformShell
      // dropped the emoji-only indicator during the Phase 3.4 redesign. Both
      // the badge over the board and the sidebar show it, so pick the first.
      await expect(hostPage.getByText(/\d+ watching/).first()).toBeVisible({ timeout: 5_000 })

      for (const p of [hostPage, guestPage]) {
        if (await p.getByText('Your turn').isVisible().catch(() => false)) {
          await emptyCells(p).first().click()
          break
        }
      }

      await expect(
        spectatorPage.locator('button[aria-label$=", X"], button[aria-label$=", O"]').first()
      ).toBeVisible({ timeout: 5_000 })
    } finally {
      await hostCtx.close()
      await guestCtx.close()
      await spectatorCtx.close()
    }
  })
})
