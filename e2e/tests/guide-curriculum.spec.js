// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Curriculum phase end-to-end (Intelligent Guide v1, Sprint 4 §5.2 / §5.4 / §5.5).
 *
 * Three scenarios assembled around the Curriculum-completion pieces:
 *
 *   1. Spar endpoint — a signed-in user can call POST /bot-games/practice
 *      with one of their bots + a tier; on completion, journey step 5 is
 *      credited.
 *
 *   2. Curriculum Cup clone — the user calls POST /tournaments/curriculum-
 *      cup/clone; a fresh isCup tournament is created with 4 participants
 *      (their bot + 3 cup-clone opponents). Step 6 fires immediately on the
 *      participant:joined publish.
 *
 *   3. Cup completion → step 7. After the cup runs (~30s with paceMs=1000),
 *      step 7 is credited and the tournament has a finalPosition for the
 *      user's bot.
 *
 * Reward popup + coaching card UI are covered by the bridge unit tests
 * (tournamentBridge.coachingCard.test.js). Asserting socket-driven UI in
 * Playwright is flaky — the bridge tests prove the emission, the unit
 * component tests prove the render.
 *
 * Prerequisites:
 *   Frontend (landing) : http://localhost:5174 (proxies tournament svc)
 *   Backend            : http://localhost:3000
 */

import { test, expect } from '@playwright/test'
import { fetchAuthToken } from './helpers.js'

const LANDING_URL = process.env.LANDING_URL || 'http://localhost:5174'

const SUBMIT_GUARD_MS = 3500

function freshEmail() {
  const ts = Date.now().toString(36)
  const r  = Math.random().toString(36).slice(2, 8)
  return `curr+${ts}-${r}@dev.local`
}

// Hardcoded display names collide on staging where prior-run users aren't
// cleaned. /users/sync slugs displayName into username (lowered, snake-cased)
// and the unique constraint trips. Suffix every display name with a random tag.
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

async function createQuickBot(request, token, displayName) {
  const res = await request.post(`${LANDING_URL}/api/v1/bots/quick`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data:    { name: displayName, persona: 'aggressive' },
  })
  if (!res.ok()) throw new Error(`bots/quick failed: ${res.status()} ${await res.text()}`)
  const body = await res.json()
  return body.bot
}

async function fetchJourney(request, token) {
  const res = await request.get(`${LANDING_URL}/api/v1/guide/preferences`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok()) return []
  const body = await res.json()
  return body?.preferences?.journeyProgress?.completedSteps
      ?? body?.journeyProgress?.completedSteps
      ?? []
}

async function pollForStep(request, token, stepIndex, deadlineMs = 60_000) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    const completed = await fetchJourney(request, token)
    if (completed.includes(stepIndex)) return completed
    await new Promise(r => setTimeout(r, 1500))
  }
  return await fetchJourney(request, token)
}

test.describe('Curriculum — Spar endpoint credits step 5 (§5.2)', () => {
  test.setTimeout(120_000)

  test('POST /bot-games/practice → series completes → step 5 credited', async ({ page, context }) => {
    await dismissWelcomeOnLoad(page)
    const email    = freshEmail()
    const password = 'curr-test-pw-1234'
    await signUp(page, { email, password, displayName: uniqueName('Curr Spar') })

    const token = await fetchAuthToken(context.request, LANDING_URL)
    const bot   = await createQuickBot(context.request, token, 'SparBot')

    // Kick off the spar — fastest tier so the test wraps quickly.
    const sparRes = await context.request.post(`${LANDING_URL}/api/v1/bot-games/practice`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data:    { myBotId: bot.id, opponentTier: 'easy', moveDelayMs: 200 },
    })
    expect(sparRes.ok()).toBeTruthy()
    const sparBody = await sparRes.json()
    expect(sparBody.slug).toMatch(/^[A-Za-z0-9_-]{8}$/)
    expect(sparBody.opponentTier).toBe('easy')

    // Single game with 200ms/move × ≤9 moves = under ~2s, plus the record-
    // game pass. Allow 60s for slow CI.
    const completed = await pollForStep(context.request, token, 5, 60_000)
    expect(completed).toEqual(expect.arrayContaining([5]))
  })
})

test.describe('Curriculum — Cup clone fires step 6 immediately', () => {
  test.setTimeout(60_000)

  test('POST /tournaments/curriculum-cup/clone → 201 with cup + step 6', async ({ page, context }) => {
    await dismissWelcomeOnLoad(page)
    const email    = freshEmail()
    const password = 'curr-test-pw-1234'
    await signUp(page, { email, password, displayName: uniqueName('Curr Cup6') })

    const token = await fetchAuthToken(context.request, LANDING_URL)
    const bot   = await createQuickBot(context.request, token, 'CupBot6')

    // The tournament service is reachable through the landing dev proxy.
    const cloneRes = await context.request.post(`${LANDING_URL}/api/tournaments/curriculum-cup/clone`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data:    { myBotId: bot.id },
    })
    expect(cloneRes.ok()).toBeTruthy()
    const body = await cloneRes.json()
    expect(body.tournament?.name).toMatch(/Curriculum Cup/i)
    expect(body.participants).toHaveLength(4)
    // Slot 0 is the user's bot
    expect(body.participants[0].isCallerBot).toBe(true)

    // Step 6 fires through the participant:joined → bridge path. The
    // publish is fire-and-forget, so a small grace window is needed.
    const completed = await pollForStep(context.request, token, 6, 30_000)
    expect(completed).toEqual(expect.arrayContaining([6]))
  })
})

test.describe('Curriculum — Cup runs to completion → step 7 (§5.4 + §5.5)', () => {
  // Cup runs 3 games sequentially (R1×2 then R2×1). At paceMs ~1000 with ≤9
  // moves per game, that's ~30s of bot play plus completion bookkeeping.
  // Generous headroom for CI variance.
  test.setTimeout(240_000)

  test('cloned cup completes within the soak window and credits step 7', async ({ page, context }) => {
    await dismissWelcomeOnLoad(page)
    const email    = freshEmail()
    const password = 'curr-test-pw-1234'
    await signUp(page, { email, password, displayName: uniqueName('Curr Cup7') })

    const token = await fetchAuthToken(context.request, LANDING_URL)
    const bot   = await createQuickBot(context.request, token, 'CupBot7')

    const cloneRes = await context.request.post(`${LANDING_URL}/api/tournaments/curriculum-cup/clone`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data:    { myBotId: bot.id },
    })
    expect(cloneRes.ok()).toBeTruthy()
    const tournamentId = (await cloneRes.json()).tournament.id

    // Wait for step 7 — fires from tournamentBridge after tournament:completed.
    const completed = await pollForStep(context.request, token, 7, 180_000)
    expect(completed).toEqual(expect.arrayContaining([7]))

    // Confirm the tournament itself reached COMPLETED
    const tRes = await context.request.get(`${LANDING_URL}/api/tournaments/${tournamentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(tRes.ok()).toBeTruthy()
    const t = (await tRes.json()).tournament
    expect(t.status).toBe('COMPLETED')
  })
})
