/**
 * Shared helpers for XO Arena E2E tests.
 *
 * Prerequisites — full stack must be running before `npm run test:e2e`:
 *   Frontend : http://localhost:5173
 *   Backend  : http://localhost:3000
 *   Postgres : localhost:5432
 *   Redis    : localhost:6379  (optional — Socket.io falls back to in-memory)
 *
 * Quick start:
 *   docker compose up          # start infra + app
 *   npm run test:e2e           # run Playwright
 *
 * Or for local dev servers:
 *   docker compose up postgres redis
 *   npm run dev:all            # in another terminal
 *   npm run test:e2e
 */

/**
 * Play through a PvAI game on `page` until it ends (win, AI win, or draw).
 * Returns the end-state text found ('You win', 'AI wins', or 'Draw').
 */
export async function playPvAIToEnd(page) {
  const endTexts = ['You win', 'AI wins', 'Draw']

  for (let i = 0; i < 9; i++) {
    // Check if already over
    for (const txt of endTexts) {
      if (await page.getByText(txt, { exact: false }).isVisible().catch(() => false)) {
        return txt
      }
    }

    // Click an empty cell
    const cells = page.getByRole('button', { name: /^Cell \d+$/ })
    if (await cells.count() === 0) break
    await cells.first().click()
    await page.waitForTimeout(800) // wait for AI response
  }

  for (const txt of endTexts) {
    if (await page.getByText(txt, { exact: false }).isVisible().catch(() => false)) {
      return txt
    }
  }
  return null
}

/**
 * Create a PvP room as host and return the invite URL.
 */
export async function createRoom(page) {
  await page.goto('/play')
  await page.getByRole('button', { name: 'vs Player' }).click()
  await page.getByRole('button', { name: 'Create Room' }).click()
  const input = page.locator('input[readonly]')
  await input.waitFor({ state: 'visible' })
  return input.inputValue()
}
