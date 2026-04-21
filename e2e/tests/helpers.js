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
 */

import { expect } from '@playwright/test'

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

    // Wait for player's turn then click first available empty cell
    await expect(page.getByText('Your turn')).toBeVisible({ timeout: 10_000 })
    const cells = page.getByRole('button', { name: /^Cell \d+$/ })
    if (await cells.count() === 0) break
    await cells.first().click()
    await page.waitForTimeout(800) // allow AI to respond
  }

  for (const txt of endTexts) {
    if (await page.getByText(txt, { exact: false }).isVisible().catch(() => false)) {
      return txt
    }
  }
  return null
}

/**
 * Navigate to /play and wait for the auto-created room invite URL to appear.
 * Returns the invite URL string.
 *
 * Requires: backend running at localhost:3000 (via docker compose or directly).
 * If "Creating room…" persists and this times out, the backend socket is unavailable.
 */
export async function getInviteUrl(page) {
  await page.goto('/play')
  // The "Invite a Friend" card shows a readonly input once the auto-room is ready.
  // Wait for the element to appear first (clearer timeout message than .not.toHaveValue).
  const input = page.locator('input[readonly]').first()
  await input.waitFor({ state: 'visible', timeout: 15_000 })
  return input.inputValue()
}

/**
 * Sign in a user via the BetterAuth email endpoint and store the session in the
 * page's browser context. Subsequent page.goto() calls will be authenticated.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} email
 * @param {string} password
 * @param {string} backendUrl  e.g. 'http://localhost:3000'
 */
export async function signIn(page, email, password, backendUrl) {
  const res = await page.context().request.post(`${backendUrl}/api/auth/sign-in/email`, {
    data: { email, password },
  })
  if (!res.ok()) {
    const body = await res.text().catch(() => '')
    throw new Error(`Sign-in failed (${res.status()}): ${body}`)
  }
}

/**
 * Fetch a Better Auth JWT for the current context (must be signed in already).
 * The landing dev server proxies /api/token to backend /api/auth/token.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} backendUrl
 * @returns {Promise<string>}
 */
export async function fetchAuthToken(request, backendUrl) {
  // Backend mounts /api/token → auth.api.getToken (Better Auth JWT plugin).
  const res = await request.get(`${backendUrl}/api/token`)
  if (!res.ok()) throw new Error(`Failed to fetch auth token: ${res.status()}`)
  const data = await res.json()
  if (!data.token) throw new Error('No token in response — user may not be signed in on this context')
  return data.token
}

/**
 * Tournament API client for tests. `base` must point at the tournament service
 * (typically via the landing dev server proxy, e.g. http://localhost:5174).
 *
 * All methods accept `{ request, token }`:
 *   request — Playwright APIRequestContext (page.context().request or test `request`)
 *   token   — Bearer JWT (use fetchAuthToken after signIn)
 */
export function tournamentApi(base) {
  const url = (path) => `${base}${path}`
  const hdr = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })
  return {
    async create({ request, token }, body) {
      const res = await request.post(url('/api/tournaments'), { headers: hdr(token), data: body })
      if (!res.ok()) throw new Error(`tournaments.create ${res.status()}: ${await res.text()}`)
      return (await res.json()).tournament
    },
    async get({ request, token }, id) {
      const res = await request.get(url(`/api/tournaments/${id}`), { headers: hdr(token) })
      if (!res.ok()) throw new Error(`tournaments.get ${res.status()}: ${await res.text()}`)
      return (await res.json()).tournament
    },
    async publish({ request, token }, id) {
      const res = await request.post(url(`/api/tournaments/${id}/publish`), { headers: hdr(token), data: {} })
      if (!res.ok()) throw new Error(`tournaments.publish ${res.status()}: ${await res.text()}`)
      return (await res.json()).tournament
    },
    async start({ request, token }, id) {
      const res = await request.post(url(`/api/tournaments/${id}/start`), { headers: hdr(token), data: {} })
      if (!res.ok()) throw new Error(`tournaments.start ${res.status()}: ${await res.text()}`)
      return (await res.json()).tournament
    },
    async addSeededBot({ request, token }, id, body) {
      const res = await request.post(url(`/api/tournaments/${id}/add-seeded-bot`), { headers: hdr(token), data: body })
      if (!res.ok()) throw new Error(`tournaments.addSeededBot ${res.status()}: ${await res.text()}`)
      return await res.json()
    },
    async register({ request, token }, id, body = {}) {
      const res = await request.post(url(`/api/tournaments/${id}/register`), { headers: hdr(token), data: body })
      if (!res.ok()) throw new Error(`tournaments.register ${res.status()}: ${await res.text()}`)
      return await res.json()
    },
    async cancel({ request, token }, id) {
      const res = await request.post(url(`/api/tournaments/${id}/cancel`), { headers: hdr(token), data: {} })
      if (!res.ok()) throw new Error(`tournaments.cancel ${res.status()}: ${await res.text()}`)
      return (await res.json()).tournament
    },

    // Admin-authenticated match completion directly on the tournament service.
    // Use for bot-vs-bot matches in tests where you need deterministic outcomes
    // without waiting for the server-side bot runner.
    async completeMatchAsAdmin({ request, token }, matchId, body) {
      const res = await request.post(url(`/api/matches/${matchId}/complete`), { headers: hdr(token), data: body })
      if (!res.ok()) throw new Error(`matches.complete ${res.status()}: ${await res.text()}`)
      return await res.json()
    },

    // User-authenticated match completion through the backend proxy.
    // Mirrors the MIXED match flow: user submits their own result, backend
    // validates they're a participant, forwards to tournament service with
    // the internal secret.
    async completeMatchAsUser({ request, token, backendBase }, matchId, body) {
      const res = await request.post(`${backendBase}/api/v1/tournament-matches/${matchId}/complete`, {
        headers: hdr(token), data: body,
      })
      if (!res.ok()) throw new Error(`tournament-matches.complete ${res.status()}: ${await res.text()}`)
      return await res.json()
    },
  }
}

/**
 * Poll a predicate every `intervalMs` until it returns truthy, or timeout.
 * Returns the last value when predicate succeeds; throws on timeout.
 */
export async function pollUntil(predicate, { timeoutMs = 30_000, intervalMs = 500, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await predicate()
    if (last) return last
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error(`pollUntil timed out waiting for ${label}`)
}

// Map legacy difficulty names to current select values
const DIFFICULTY_MAP = { easy: 'novice', medium: 'intermediate', hard: 'advanced', novice: 'novice', intermediate: 'intermediate', advanced: 'advanced', master: 'master' }

/**
 * Start a PvAI game from /play. Expands the AI panel, selects difficulty and mark,
 * then clicks the start button.
 */
export async function startPvAIGame(page, { difficulty = 'novice', mark = 'X' } = {}) {
  await page.goto('/play')
  // Expand the "Play vs AI" accordion
  await page.locator('button').filter({ hasText: 'Play vs AI' }).first().click()
  // Wait for the difficulty select to appear (Minimax tab is default)
  const difficultySelect = page.locator('select').filter({ has: page.locator('option[value="novice"]') })
  await difficultySelect.waitFor({ state: 'visible' })
  await difficultySelect.selectOption(DIFFICULTY_MAP[difficulty] ?? difficulty)
  // Select mark (X / O / alternate)
  await page.getByRole('button', { name: mark, exact: true }).click()
  // Click the "Play vs AI" start button inside the expanded panel
  await page.locator('button').filter({ hasText: /^Play vs AI$/ }).click()
}
