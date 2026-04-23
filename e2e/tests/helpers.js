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
 * Play through a PvAI game on `page` until it ends.
 * Returns the end-state text found ('You win', 'Opponent wins', or 'Draw').
 */
export async function playPvAIToEnd(page) {
  const endTexts = ['You win', 'Opponent wins', 'Draw']

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
 * Create a Table as the signed-in host and return an invite URL the guest
 * can use to land directly on the game board.
 *
 * Replaces the deprecated `getInviteUrl(page)` which relied on `/play`
 * auto-creating a room with a visible readonly invite input. That
 * auto-room flow was removed in Phase 3.4 — Tables are now the only
 * game-session primitive and they require an authenticated creator.
 *
 * Returns `{ slug, inviteUrl }` where `inviteUrl` is of the form
 * `/play?join=<slug>` — the same shape the old invite input emitted.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} token              Bearer JWT for the host
 * @param {string} [backendUrl]       Defaults to localhost backend
 */
export async function createGuestTable(request, token, backendUrl = 'http://localhost:3000') {
  const res = await request.post(`${backendUrl}/api/v1/tables`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      gameId: 'xo',
      minPlayers: 2,
      maxPlayers: 2,
      isPrivate: false,
    },
  })
  if (!res.ok()) throw new Error(`Create table failed: ${res.status()} ${await res.text()}`)
  const { table } = await res.json()
  return { slug: table.slug, tableId: table.id, inviteUrl: `/play?join=${table.slug}` }
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

    // True recurring seed bots (vs addSeededBot which creates one-off
    // testbots). Body: { bots: [{ name, skillLevel: 'rusty'|'copper'|
    // 'sterling'|'magnus' }] }. Also writes a TournamentSeedBot config row,
    // which is what causes the bot to propagate to future recurring
    // occurrences.
    async addSeedBots({ request, token }, id, bots) {
      const res = await request.post(url(`/api/tournaments/${id}/seed-bots`), { headers: hdr(token), data: { bots } })
      if (!res.ok()) throw new Error(`tournaments.addSeedBots ${res.status()}: ${await res.text()}`)
      return await res.json()
    },
    async listSeedBots({ request, token }, id) {
      const res = await request.get(url(`/api/tournaments/${id}/seed-bots`), { headers: hdr(token) })
      if (!res.ok()) throw new Error(`tournaments.listSeedBots ${res.status()}: ${await res.text()}`)
      return (await res.json()).seedBots
    },
    async removeSeedBot({ request, token }, id, botUserId) {
      const res = await request.delete(url(`/api/tournaments/${id}/seed-bots/${botUserId}`), { headers: hdr(token) })
      if (!res.ok()) throw new Error(`tournaments.removeSeedBot ${res.status()}: ${await res.text()}`)
      return res.status()
    },
    async triggerRecurringCheck({ request, token }) {
      const res = await request.post(url('/api/tournaments/admin/scheduler/check-recurring'), { headers: hdr(token), data: {} })
      if (!res.ok()) throw new Error(`tournaments.triggerRecurringCheck ${res.status()}: ${await res.text()}`)
      return await res.json()
    },
    async forceComplete({ request, token }, id) {
      // Admin/QA shortcut: flip a tournament to COMPLETED without playing
      // out the bracket. The regular PATCH intentionally excludes `status`,
      // so this dedicated endpoint exists in the service for tests that need
      // to trigger completion-dependent flows (e.g. recurring-sweep spawns).
      const res = await request.post(url(`/api/tournaments/${id}/admin/force-complete`), { headers: hdr(token), data: {} })
      if (!res.ok()) throw new Error(`tournaments.forceComplete ${res.status()}: ${await res.text()}`)
      return (await res.json()).tournament
    },
    async register({ request, token }, id, body = {}) {
      const res = await request.post(url(`/api/tournaments/${id}/register`), { headers: hdr(token), data: body })
      if (!res.ok()) throw new Error(`tournaments.register ${res.status()}: ${await res.text()}`)
      return await res.json()
    },

    // Subscribe the authenticated user as a recurring standing participant on
    // the given template. Unlike register(), this creates a
    // RecurringTournamentRegistration row so the sweep auto-enrolls the user
    // in every new occurrence spawned from this template.
    async subscribeRecurring({ request, token }, templateId) {
      const res = await request.post(url(`/api/recurring/${templateId}/register`), { headers: hdr(token), data: {} })
      if (!res.ok()) throw new Error(`recurring.register ${res.status()}: ${await res.text()}`)
      return (await res.json()).registration
    },
    async unsubscribeRecurring({ request, token }, templateId) {
      const res = await request.delete(url(`/api/recurring/${templateId}/register`), { headers: hdr(token) })
      // 404 is acceptable for cleanup paths (already unsubscribed).
      if (!res.ok() && res.status() !== 404) {
        throw new Error(`recurring.unregister ${res.status()}: ${await res.text()}`)
      }
      return res.status()
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

    // ─── Template-based admin endpoints (Phase 3.7a) ──────────────────────
    // These are distinct from the per-tournament seed-bots helpers above:
    // `TournamentTemplate` is the config-only row the scheduler reads when
    // spawning the next recurring occurrence. Adding a seed to a template
    // pre-registers a bot on every occurrence spawned from it.

    async listTemplates({ request, token }) {
      const res = await request.get(url('/api/tournaments/admin/templates'), { headers: hdr(token) })
      if (!res.ok()) throw new Error(`templates.list ${res.status()}: ${await res.text()}`)
      return (await res.json()).templates
    },
    async getTemplate({ request, token }, id) {
      const res = await request.get(url(`/api/tournaments/admin/templates/${id}`), { headers: hdr(token) })
      if (!res.ok()) throw new Error(`templates.get ${res.status()}: ${await res.text()}`)
      return await res.json()
    },
    async deleteTemplate({ request, token }, id) {
      const res = await request.delete(url(`/api/tournaments/admin/templates/${id}`), { headers: hdr(token) })
      if (!res.ok() && res.status() !== 404) throw new Error(`templates.delete ${res.status()}: ${await res.text()}`)
      return res.status()
    },
    // Two payload shapes:
    //   { userId }                           — seed an existing system bot
    //   { personaBotId, displayName }        — clone persona + seed
    async addTemplateSeed({ request, token }, templateId, payload) {
      const res = await request.post(url(`/api/tournaments/admin/templates/${templateId}/seed-bots`), {
        headers: hdr(token), data: payload,
      })
      return { status: res.status(), body: res.ok() ? await res.json() : await res.text() }
    },
    async removeTemplateSeed({ request, token }, templateId, userId) {
      const res = await request.delete(url(`/api/tournaments/admin/templates/${templateId}/seed-bots/${userId}`), {
        headers: hdr(token),
      })
      return res.status()
    },
  }
}

/**
 * Backend admin API — needed for system-bot listing + delete guard. The
 * tournament service only knows about tournaments/templates; the User table
 * lives on the backend.
 */
export function backendAdminApi(base) {
  const url = (path) => `${base}${path}`
  const hdr = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })
  return {
    async listBots({ request, token }, { systemOnly = false, search = '' } = {}) {
      const qs = new URLSearchParams()
      if (systemOnly) qs.set('systemOnly', '1')
      if (search)     qs.set('search', search)
      const suffix = qs.toString() ? `?${qs}` : ''
      const res = await request.get(url(`/api/v1/admin/bots${suffix}`), { headers: hdr(token) })
      if (!res.ok()) throw new Error(`admin.listBots ${res.status()}: ${await res.text()}`)
      return await res.json()
    },
    async deleteBot({ request, token }, botId) {
      const res = await request.delete(url(`/api/v1/admin/bots/${botId}`), { headers: hdr(token) })
      // Return { status, body } so callers can assert on both 204 (ok) and 400 (built-in guard).
      const bodyText = await res.text()
      let body = null
      try { body = bodyText ? JSON.parse(bodyText) : null } catch { body = bodyText }
      return { status: res.status(), body }
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

/**
 * Start a PvAI game against the community bot.
 *
 * The old mode-selection UI (difficulty/mark picker accordion) was removed in
 * Phase 3.4 — /play is now URL-driven. The `difficulty` and `mark` arguments
 * are kept for back-compat with existing specs but are ignored; the server
 * picks the community bot and the mark.
 *
 * Also pre-dismisses the first-visit guest welcome modal that otherwise
 * overlays the board and blocks clicks in a fresh Playwright context.
 */
export async function startPvAIGame(page, _opts = {}) {
  await page.addInitScript(() => {
    try { window.localStorage?.setItem('aiarena_guest_welcome_seen', '1') } catch {}
  })
  await page.goto('/play?action=vs-community-bot')
  // The board is the authoritative signal that the game started.
  await page.locator('[aria-label="Tic-tac-toe board"]').waitFor({ state: 'visible', timeout: 15_000 })
}
