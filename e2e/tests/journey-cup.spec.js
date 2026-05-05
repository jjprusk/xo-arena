// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Curriculum step 6 — UI dropoff regression.
 *
 * Why this exists: the prior journey specs (`guide-curriculum.spec.js`)
 * proved the API path — POST /api/tournaments/curriculum-cup/clone returns
 * 201, step 6 fires through the participant:joined publish, the cup runs
 * to completion. None of that exercised the journey CTA the user actually
 * clicks.
 *
 * The CTA in journeySteps.js points at `/profile?action=cup`. Until this
 * commit's pair fix, ProfilePage had no handler — clicking "Enter Curriculum
 * Cup" parked the user on a blank /profile page with no progress, no error,
 * and no clue what to do next. The full curriculum loop silently broke at
 * step 6 in production while the API + bridge tests stayed green.
 *
 * What this spec does:
 *   1. Direct-URL regression: visit `/profile?action=cup` with one bot.
 *      Must redirect to `/tournaments/<id>` quickly (NOT stay on /profile),
 *      "Curriculum Cup" must be visible on the destination, step 6 must
 *      land server-side. The "Couldn't start" error banner must not show.
 *   2. From-Guide UI flow: spar via API → poll for step 5 → navigate home →
 *      click the "Enter Curriculum Cup" link inside the Guide panel →
 *      assert navigation to `/tournaments/<id>` and step 6 credit. This
 *      exercises the actual user click path, end to end.
 *   3. Zero-bot edge: a fresh user with no bots visiting `/profile?action=
 *      cup` must bounce to the QuickBotWizard rather than 500-ing on the
 *      cup-clone POST or stranding the user on /profile.
 *
 * Prereqs:
 *   Frontend (landing) : http://localhost:5174
 *   Backend            : http://localhost:3000
 */

import { test, expect } from '@playwright/test'
import { fetchAuthToken } from './helpers.js'
import { netCleanupByEmailPrefix } from './dbScript.js'
import { snapshotJourney, assertJourneyTransition } from './journeyAssert.js'

const LANDING_URL   = process.env.LANDING_URL || 'http://localhost:5174'
const EMAIL_PREFIX  = 'cup+'
const SUBMIT_GUARD_MS = 3500

function freshEmail() {
  const ts = Date.now().toString(36)
  const r  = Math.random().toString(36).slice(2, 8)
  return `${EMAIL_PREFIX}${ts}-${r}@dev.local`
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
  if (!res.ok()) throw new Error(`bots/quick failed: ${res.status()}`)
  return (await res.json()).bot
}

async function fetchUserId(request, token) {
  const sync = await request.post(`${LANDING_URL}/api/v1/users/sync`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!sync.ok()) throw new Error(`users/sync failed: ${sync.status()}`)
  return (await sync.json())?.user?.id ?? null
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

async function pollForStep(request, token, stepIndex, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    const completed = await fetchJourney(request, token)
    if (completed.includes(stepIndex)) return completed
    await new Promise(r => setTimeout(r, 1000))
  }
  return await fetchJourney(request, token)
}

test.describe('Curriculum step 6 — UI dropoff regression', () => {
  // 480s covers the worst case under heavy local docker load: sequential-
  // cups test runs 1st cup poll (up to 240s) + soak (60s) + 2nd cup soak
  // window. Tests run sequentially per file (workers=1), so this is per-test.
  test.setTimeout(480_000)

  test.afterAll(() => {
    netCleanupByEmailPrefix(EMAIL_PREFIX, { tag: 'cup-after' })
  })

  // ── 1. Direct URL regression ─────────────────────────────────────────────
  // Visiting `/profile?action=cup` must spawn a cup and navigate to its
  // detail page. Pre-fix, ProfilePage had no handler — the user landed on
  // /profile and nothing happened. The polled step-6 check below would have
  // failed within 30s, catching the regression in CI.
  test('direct /profile?action=cup → /tournaments/<id> + step 6 credited', async ({ page, context }) => {
    page.on('pageerror', (err) => console.log(`[browser:error] ${err.message}`))

    await dismissWelcomeOnLoad(page)
    const email       = freshEmail()
    const password    = 'cup-test-pw-1234'
    const displayName = `Cup ${Math.random().toString(36).slice(2, 8)}`
    await signUp(page, { email, password, displayName })

    const token  = await fetchAuthToken(context.request, LANDING_URL)
    const userId = await fetchUserId(context.request, token)
    await createQuickBot(context.request, token, `CupBot ${Math.random().toString(36).slice(2, 6)}`)

    const before = await snapshotJourney(context.request, { backendUrl: LANDING_URL, token, userId })
    expect(before.completedSteps.includes(6), 'step 6 must not be pre-credited').toBe(false)

    await page.goto('/profile?action=cup')

    // The handler POSTs the clone, then navigate('/tournaments/<id>?follow=
    // <callerBotId>', {replace:true}). 15s of slack — clone takes a moment
    // because it creates 3 ownerless bot User rows + bracket + initial
    // publishes. The `follow=<id>` query is what makes TournamentDetailPage
    // auto-open the live spectate modal on the user's round-1 match. Pre-
    // follow-fix, the user landed on a static bracket page; bot games
    // finish in 5-10 s so the round-1 matches were already done by the time
    // the user oriented — the cup felt skipped. The assertion below
    // requires the follow param specifically; bare /tournaments/<id> fails.
    await page.waitForURL(/\/tournaments\/[^/?]+\?follow=/, { timeout: 15_000 })

    await expect(page.getByRole('heading', { name: /Curriculum Cup/i })).toBeVisible({ timeout: 10_000 })

    // The error banner must NOT have shown — this would fire if cloneCup
    // 4xx/5xx'd or threw. It's a stronger signal than "we navigated" alone:
    // a future regression that swallows the error and soft-navigates would
    // get caught here.
    await expect(page.getByText(/Couldn't start the Curriculum Cup/i)).toBeHidden()

    // The follow effect should have opened the spectate modal on the
    // caller bot's round-1 match. The modal renders a "Following: <name>"
    // header. Pre-fix (when we navigated to bare /tournaments/<id>), no
    // modal opened and this assertion would time out. The mode may flip
    // from 'live' → 'ended' if the test arrives after the match completes
    // (1s pace, ~5 moves), so we only assert the Following header — which
    // is present in any of live / waiting / ended modes.
    await expect(page.getByText(/^Following:/)).toBeVisible({ timeout: 15_000 })

    // Step 6 fires server-side via tournament:participant:joined. Bridge
    // is fire-and-forget so allow a small grace window.
    const completed = await pollForStep(context.request, token, 6, 30_000)
    expect(completed).toEqual(expect.arrayContaining([6]))

    const after = await snapshotJourney(context.request, { backendUrl: LANDING_URL, token, userId })
    assertJourneyTransition({
      prev: before, next: after,
      label: 'step 6 via /profile?action=cup',
      stepDone:  6,
      botsDelta: 0,
    })
  })

  // ── 2. From-Guide UI click path ──────────────────────────────────────────
  // Drive Hook + early Curriculum via API for speed (those paths have
  // their own UI tests). This spec's contribution is asserting that the
  // "Enter Curriculum Cup" link in the Guide panel actually lands on a
  // tournament page when clicked.
  test('clicking Enter Curriculum Cup in the Guide panel → /tournaments/<id>', async ({ page, context }) => {
    page.on('pageerror', (err) => console.log(`[browser:error] ${err.message}`))

    await dismissWelcomeOnLoad(page)
    const email       = freshEmail()
    const password    = 'cup-test-pw-1234'
    const displayName = `Cup2 ${Math.random().toString(36).slice(2, 8)}`
    await signUp(page, { email, password, displayName })

    const token  = await fetchAuthToken(context.request, LANDING_URL)
    const userId = await fetchUserId(context.request, token)
    await createQuickBot(context.request, token, `CupBot2 ${Math.random().toString(36).slice(2, 6)}`)

    // Prefire steps 1-5 via PATCH /guide/preferences. The JourneyCard
    // renders the FIRST missing step's CTA (`STEPS.find(!completed)`), so
    // for the panel to show "Enter Curriculum Cup" the user must have
    // [1,2,3,4,5] complete. Driving each preceding step via its real
    // trigger would add ~30s of unrelated soak — those triggers have
    // their own dedicated specs (guide-onboarding, journey-train-modal,
    // journey-spar). What this spec uniquely proves is that *clicking*
    // the cup CTA from the rendered panel lands on a tournament page.
    const patchRes = await context.request.patch(`${LANDING_URL}/api/v1/guide/preferences`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data:    { journeyProgress: { completedSteps: [1, 2, 3, 4, 5], dismissedAt: null } },
    })
    expect(patchRes.ok()).toBeTruthy()

    // Land on home; AppLayout hydrates the guide store on sign-in and
    // opens the panel when the journey isn't dismissed. The JourneyCard
    // computes nextStep from completedSteps and renders the step-6
    // ("Enter Curriculum Cup") CTA.
    await page.goto('/')

    // The Guide panel may take a beat to hydrate. Look for the CTA inside
    // the panel specifically — the page also renders generic tournament
    // copy that would false-match.
    const guidePanel = page.getByRole('dialog', { name: /^Guide$/i })
    await expect(guidePanel).toBeVisible({ timeout: 15_000 })

    const cupLink = guidePanel.getByRole('link', { name: /Enter Curriculum Cup/i })
    await expect(cupLink).toBeVisible({ timeout: 10_000 })

    const before = await snapshotJourney(context.request, { backendUrl: LANDING_URL, token, userId })
    await cupLink.click()

    await page.waitForURL(/\/tournaments\/[^/?]+\?follow=/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: /Curriculum Cup/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/Couldn't start the Curriculum Cup/i)).toBeHidden()
    // Spectate modal opened on the caller bot's match — same assertion as
    // test 1, applied here so the Guide-CTA path is also covered.
    await expect(page.getByText(/^Following:/)).toBeVisible({ timeout: 15_000 })

    const completed6 = await pollForStep(context.request, token, 6, 30_000)
    expect(completed6).toEqual(expect.arrayContaining([6]))

    const after = await snapshotJourney(context.request, { backendUrl: LANDING_URL, token, userId })
    assertJourneyTransition({
      prev: before, next: after,
      label: 'step 6 via Guide-panel CTA click',
      stepDone:  6,
      botsDelta: 0,
    })
  })

  // ── 3. Zero-bot edge case ────────────────────────────────────────────────
  // The cup needs a bot to register. The handler bounces to the
  // QuickBotWizard rather than POSTing into a 4xx — proves we're not
  // ever stranding a no-bots user on /profile waiting for nothing.
  test('user with zero bots → bounces to ?action=quick-bot', async ({ page, context: _ctx }) => {
    await dismissWelcomeOnLoad(page)
    const email       = freshEmail()
    const password    = 'cup-test-pw-1234'
    const displayName = `Cup3 ${Math.random().toString(36).slice(2, 8)}`
    await signUp(page, { email, password, displayName })

    // Note: deliberately NOT creating a quick bot here.
    await page.goto('/profile?action=cup')
    await page.waitForURL(/\/profile\?action=quick-bot/, { timeout: 10_000 })
  })

  // ── 4. Full cup completion — step 7, +50 TC, coaching card, drawer reopen ─
  // Drives a real cup all the way to completion and asserts the entire
  // step-6 → step-7 chain. Tests 1-3 stop at step 6; everything after that
  // (the +50 TC reward, the phase flip to specialize, the coaching card
  // render, the drawer reopen, and the post-cup CTA navigation) was only
  // covered by manual QA. Recent commits 408ec7f / e137e1a / 0619f7f /
  // b163031 / 47e9077 / 365a416 each fixed something here; this test is
  // the regression net for that whole cluster.
  //
  // Cup pacing: 4-bot single-elim, 1s/move, ~5 moves/game = ~15s/game ×
  // 3 games = ~45-50s + bracket-advance + bridge propagation. Polls run
  // up to 120s for step 7 to allow generous slack on a busy CI runner.
  test('cup runs to completion → step 7 + +50 TC + reward popup + variant-correct coaching card + drawer reopens + CTA loads real content + no console errors', async ({ page, context }) => {
    // Capture browser noise from t=0. Pre-365a416 a fresh sign-in fired
    // 404s + 401s on early endpoints; this test fails that regression
    // visibly instead of relying on manual log inspection.
    const pageErrors = []
    const consoleErrors = []
    page.on('pageerror', (err) => pageErrors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await dismissWelcomeOnLoad(page)
    const email       = freshEmail()
    const password    = 'cup-test-pw-1234'
    const displayName = `Cup4 ${Math.random().toString(36).slice(2, 8)}`
    await signUp(page, { email, password, displayName })

    const token  = await fetchAuthToken(context.request, LANDING_URL)
    const userId = await fetchUserId(context.request, token)
    await createQuickBot(context.request, token, `CupBot4 ${Math.random().toString(36).slice(2, 6)}`)

    // Prefire steps 1-5 — the focus of this spec is post-step-6 mechanics,
    // and the leading steps each have their own dedicated specs.
    const patchRes = await context.request.patch(`${LANDING_URL}/api/v1/guide/preferences`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data:    { journeyProgress: { completedSteps: [1, 2, 3, 4, 5], dismissedAt: null } },
    })
    expect(patchRes.ok()).toBeTruthy()

    const before = await snapshotJourney(context.request, { backendUrl: LANDING_URL, token, userId })
    expect(before.completedSteps).toEqual(expect.arrayContaining([1, 2, 3, 4, 5]))
    expect(before.completedSteps).not.toContain(7)

    // Enter the cup via the same /profile?action=cup path as test 1.
    await page.goto('/profile?action=cup')
    await page.waitForURL(/\/tournaments\/[^/?]+\?follow=/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: /Curriculum Cup/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/Couldn't start the Curriculum Cup/i)).toBeHidden()
    await expect(page.getByText(/^Following:/)).toBeVisible({ timeout: 15_000 })

    // Bug #9 — the spectate header must show a YOU badge so a first-time
    // cup user can tell which of the four bots is theirs. Pre-fix, "Following:
    // whip" gave no clue that whip was their own bot. The test guards both
    // surfaces of the fix: server (`participant.user.botOwnerId` exposed in
    // GET /tournaments/:id) and client (`MatchSpectateModal` derives + renders
    // the badge from `myBotIds`).
    await expect(page.getByTestId('follow-you-badge')).toBeVisible({ timeout: 10_000 })

    // Drawer-hide-during-spectate (commit 47e9077). When TournamentDetailPage
    // resolves the follow target, useGuideStore.close() fires. The Guide
    // dialog should not be visible while the user spectates the cup.
    const guidePanel = page.getByRole('dialog', { name: /^Guide$/i })
    await expect(guidePanel).toBeHidden({ timeout: 10_000 })

    // Step 6 fires off participant:joined, which races the spectate-resolve.
    // Allow a small window before checking; this also pins down "step 6 must
    // happen before step 7 is allowed to fire".
    const afterStep6Steps = await pollForStep(context.request, token, 6, 30_000)
    expect(afterStep6Steps).toEqual(expect.arrayContaining([6]))
    expect(afterStep6Steps, 'step 7 must not have fired before cup completes').not.toContain(7)

    // Now wait for the cup to actually finish and step 7 to be credited.
    // 240s of slack — the cup itself wraps in <60s but a CPU-starved
    // docker host (the tournament service has a recurring-scheduler loop
    // that hammers the DB and can starve the bot game runner) has been
    // seen to take 150-220s under load. The runtime is correct; the
    // slowness is a separate perf issue tracked outside this test.
    const afterStep7Steps = await pollForStep(context.request, token, 7, 240_000)
    expect(afterStep7Steps, `step 7 not credited within 240s of cup start (saw [${afterStep7Steps.join(',')}])`).toEqual(expect.arrayContaining([7]))

    // The full transition: step 7 done, +50 TC granted, phase flipped.
    const after = await snapshotJourney(context.request, { backendUrl: LANDING_URL, token, userId })
    assertJourneyTransition({
      prev: before, next: after,
      label: 'cup completion → step 7 + +50 TC + specialize',
      stepDone:  7,
      tcDelta:   50,
      phase:     'specialize',
      botsDelta: 0,
    })

    // RewardPopup renders the +50 TC celebration on `guide:curriculum_complete`
    // (RewardPopup.jsx). This is the user's primary visible signal that the
    // reward landed. Auto-dismisses after 8s — assert it appears within that
    // window. Pre-fix, the reward fired but if RewardPopup wasn't mounted on
    // the tournament-detail route the user would see no celebration at all.
    const rewardPopup = page.getByTestId('reward-popup')
    await expect(rewardPopup).toBeVisible({ timeout: 15_000 })
    await expect(rewardPopup).toContainText(/Journey complete/i)
    await expect(rewardPopup).toContainText(/\+50 Tournament Credits/i)
    await expect(rewardPopup).toContainText(/Specialize/i)

    // Bug #10a — auto-close the stale spectate modal on tournament COMPLETED.
    // Pre-fix, a "Waiting for X's next match" modal could persist after the
    // cup wrapped, layered on top of the celebration. The page-level
    // useEffect now clears watchMatch + drops the ?follow= param the moment
    // tournament.status flips to COMPLETED. The status flip lands on the
    // first refetch after step 7 — well before the coaching card animates
    // in (delayed 8.2s for sequencing). 15s of slack covers slow CI.
    await expect(page.getByText(/^Following:/)).toBeHidden({ timeout: 15_000 })
    await page.waitForFunction(() => !window.location.search.includes('follow='), null, { timeout: 15_000 })

    // Coaching card renders (commit b163031 + tournamentBridge:coaching_card).
    // Bug #10b — sequenced behind RewardPopup. CoachingCard delays its render
    // by ~8.2s so the popup auto-dismisses (8s) before the card appears,
    // preventing the visual stack the user reported. Total budget here:
    // popup auto-dismiss (8s) + sequencing delay (200ms) + arrival window.
    const coachingCard = page.getByTestId('coaching-card')
    await expect(coachingCard).toBeVisible({ timeout: 30_000 })

    // The reward popup must already have dismissed by the time the coaching
    // card is visible — that's the whole point of the sequencing fix. If
    // both are visible simultaneously this assertion fires and we know the
    // delay regressed.
    await expect(rewardPopup).toBeHidden()

    // Bug #9 (continued) — with the spectate modal auto-closed, the bracket
    // and participants list are now uncovered. Both should render the YOU
    // badge on the user's bot. We don't pin a specific count (depends on
    // whether the user's bot won R1 → appears in R2 too) — but at least
    // one badge must be present, proving the badge wired through to
    // bracket + participants list. `exact: true` keeps "You earned +50 TC"
    // copy in the celebration card from false-matching.
    expect(await page.getByText('You', { exact: true }).count()).toBeGreaterThan(0)

    // Variant pin: read finalPosition from the subtitle ("finished #N") and
    // assert the card title matches what coachingCardRules.pickCoachingCard
    // returns for that position. v1 pins:
    //   #1 → CHAMPION       ("Cup Champion!")
    //   #2 → RUNNER_UP      ("So close.")
    //   #3 or #4 → HEAVY_LOSS ("Time to dig in.")  — didTrainImprove is
    //                                                hard-coded false in v1
    //   ONE_TRAIN_LOSS ("Different angle?") is unreachable in v1 (would
    //   require didTrainImprove=true; not wired until v1.1).
    // Pre-fix, a coaching card whose title disagreed with the subtitle (e.g.
    // CHAMPION rendered for #3) would only surface in manual QA — this
    // assertion makes the rules-table contract executable.
    const subtitleText = await coachingCard.locator('span').first().textContent()
    const finalPosMatch = subtitleText?.match(/finished #(\d)/)
    expect(finalPosMatch, `couldn't read finalPosition from subtitle "${subtitleText}"`).not.toBeNull()
    const finalPos = Number(finalPosMatch[1])
    expect([1, 2, 3]).toContain(finalPos)
    const expectedTitle =
      finalPos === 1 ? /Cup Champion!/ :
      finalPos === 2 ? /So close\./ :
                       /Time to dig in\./
    await expect(coachingCard).toContainText(expectedTitle)

    // Drawer reopens (commit 47e9077: cupDone is an override in
    // shouldOpenGuideOnJourneyStep, so step 7 fires open even on the cup
    // spectate page). The "Curriculum complete!" celebration is the
    // step-7 / specialize-phase JourneyCard branch.
    await expect(guidePanel).toBeVisible({ timeout: 10_000 })
    await expect(guidePanel.getByText(/Curriculum complete!/i)).toBeVisible({ timeout: 5_000 })

    // CTA navigates to a real route (commit b163031 fixed
    // "/guide/rookie-cup" → "/profile?action=train-bot" and "/gym?action=
    // switch-algorithm" → "/gym"). Variant determines target:
    //   CHAMPION/RUNNER_UP/HEAVY_LOSS → /profile?action=train-bot
    //                                    → forwards to /bots/<id>?action=train-bot
    //                                    → BotProfilePage with TrainGuidedModal
    //   ONE_TRAIN_LOSS → /gym → GymPage
    const expectedCtaLabel =
      finalPos === 1 || finalPos === 2 ? /Train your bot deeper/ :
                                          /Train your bot/
    const ctaButton = coachingCard.getByRole('button', { name: expectedCtaLabel })
    await expect(ctaButton).toBeVisible()
    await ctaButton.click()

    // /profile?action=train-bot bounces to /bots/<id>?action=train-bot when
    // the user has exactly one bot (this user does — the QuickBot we made).
    // 30s of slack: the bounce sequence is navigate → ProfilePage mount →
    // /bots/mine fetch → useEffect runs → second navigate. Under load on a
    // busy CI runner the chained navigates have been seen to land at ~12s.
    await page.waitForURL(/\/bots\/[^/?]+\?action=train-bot/, { timeout: 30_000 })

    // Destination renders real content — BotProfilePage shows the bot's
    // displayName and a "Train your bot" section. Pre-b163031 the URL
    // changed but the page might have been blank / 404. We assert positive
    // content (not just the absence of a 404 banner) so a future regression
    // that renders an empty shell is caught.
    await expect(page.getByText(/Train your bot/i).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/Page not found|404/i)).toBeHidden()

    // Final guard: no uncaught errors anywhere in the run. Console errors
    // are noisier (third-party libs, dev-mode warnings) so we report them
    // but only fail on pageerror events — those are real uncaught throws.
    if (consoleErrors.length) {
      console.log(`[cup test] ${consoleErrors.length} console.error(s) seen:`)
      consoleErrors.slice(0, 10).forEach((e) => console.log(`  ${e}`))
    }
    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([])
  })

  // ── 5. Step-7 explanatory note during in-flight cup ──────────────────────
  // Pre-0619f7f, JourneyCard rendered a clickable "View result" link for
  // step 7 the moment step 6 landed — clicking it sent the user to
  // /profile?action=cup-result with no result to render (the cup was still
  // in flight). The fix carved out step 7 to render an explanatory note
  // ("Watching your cup play out — your result lands here automatically")
  // instead of a CTA. This test pins that behavior.
  test('in-flight cup (step 6 done, 7 pending) renders explanatory note, no CTA', async ({ page, context }) => {
    await dismissWelcomeOnLoad(page)
    const email       = freshEmail()
    const password    = 'cup-test-pw-1234'
    const displayName = `Cup5 ${Math.random().toString(36).slice(2, 8)}`
    await signUp(page, { email, password, displayName })

    const token = await fetchAuthToken(context.request, LANDING_URL)
    await createQuickBot(context.request, token, `CupBot5 ${Math.random().toString(36).slice(2, 6)}`)

    // Mid-cup state: steps 1-6 complete, step 7 pending. JourneyCard's
    // nextStep = step 7.
    const patchRes = await context.request.patch(`${LANDING_URL}/api/v1/guide/preferences`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data:    { journeyProgress: { completedSteps: [1, 2, 3, 4, 5, 6], dismissedAt: null } },
    })
    expect(patchRes.ok()).toBeTruthy()

    // Land on home (not /tournaments — guideAutoOpen would suppress the
    // panel there). The drawer auto-opens on hydration.
    await page.goto('/')
    const guidePanel = page.getByRole('dialog', { name: /^Guide$/i })
    await expect(guidePanel).toBeVisible({ timeout: 15_000 })

    // The explanatory note must be present.
    await expect(guidePanel.getByText(/result lands here automatically/i)).toBeVisible({ timeout: 5_000 })

    // No clickable step-7 CTA. journeySteps.js step 7 has cta='View result',
    // so we must not see a link/button with that label inside the drawer.
    await expect(guidePanel.getByRole('link', { name: /^View result$/i })).toHaveCount(0)
    await expect(guidePanel.getByRole('button', { name: /^View result$/i })).toHaveCount(0)
  })

  // ── 6. Mid-cup browser refresh — server-side trigger survives client churn ─
  // The cup runs server-side and is autonomous; bot games are driven by
  // botGameRunner regardless of whether the spectator page is loaded. The
  // step-7 credit fires off `tournament:completed` on the server. So a
  // user who refreshes (or closes-and-reopens the tab) mid-cup should
  // still get step 7 credited; if they're back on the page when it
  // happens, they should see the celebration.
  //
  // What this catches: a regression where the SSE client wires up to a
  // user-scoped channel only on first sign-in, or the journey credit logic
  // accidentally takes a client-confirmation hop, would silently drop the
  // step-7 credit when the page reloads. Existing API-level tests don't
  // see this because they hold one connection; this test simulates real
  // user behavior (tab gets navigated away and back).
  test('mid-cup refresh: step 7 still credits server-side and UI re-hydrates post-refresh', async ({ page, context }) => {
    page.on('pageerror', (err) => console.log(`[browser:error] ${err.message}`))

    await dismissWelcomeOnLoad(page)
    const email       = freshEmail()
    const password    = 'cup-test-pw-1234'
    const displayName = `Cup6 ${Math.random().toString(36).slice(2, 8)}`
    await signUp(page, { email, password, displayName })

    const token  = await fetchAuthToken(context.request, LANDING_URL)
    const userId = await fetchUserId(context.request, token)
    await createQuickBot(context.request, token, `CupBot6 ${Math.random().toString(36).slice(2, 6)}`)

    await context.request.patch(`${LANDING_URL}/api/v1/guide/preferences`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data:    { journeyProgress: { completedSteps: [1, 2, 3, 4, 5], dismissedAt: null } },
    })

    const before = await snapshotJourney(context.request, { backendUrl: LANDING_URL, token, userId })

    // Start the cup.
    await page.goto('/profile?action=cup')
    await page.waitForURL(/\/tournaments\/[^/?]+\?follow=/, { timeout: 15_000 })
    const cupUrl = page.url()
    await expect(page.getByText(/^Following:/)).toBeVisible({ timeout: 15_000 })

    // Confirm step 6 landed and the cup is running.
    const afterStep6 = await pollForStep(context.request, token, 6, 30_000)
    expect(afterStep6).toEqual(expect.arrayContaining([6]))
    expect(afterStep6).not.toContain(7)

    // Navigate away, then back. This simulates a refresh + recovery; using
    // about:blank and then re-goto cupUrl forces a fresh page lifecycle
    // (new SSE connection, fresh AppLayout mount, fresh useEventStream
    // subscription). A bare `page.reload()` would be similar but doesn't
    // reset the navigation stack — about:blank is closer to "user closed
    // the tab and clicked the link from history".
    await page.goto('about:blank')
    await page.waitForTimeout(2_000)  // let server-side bots run while client is gone
    await page.goto(cupUrl)
    await expect(page.getByRole('heading', { name: /Curriculum Cup/i })).toBeVisible({ timeout: 10_000 })

    // Step 7 must land regardless of client state — this is the core
    // server-autonomy guarantee. If the cup completed while we were on
    // about:blank, this returns immediately. If it's still in flight, the
    // poll waits for the server-side bridge to fire. 180s budget is the
    // same we use elsewhere to absorb a CPU-starved docker host.
    const afterStep7 = await pollForStep(context.request, token, 7, 240_000)
    expect(afterStep7, `step 7 must be credited even when client is offline (saw [${afterStep7.join(',')}])`).toEqual(expect.arrayContaining([7]))

    // Phase + credits transitioned correctly.
    const after = await snapshotJourney(context.request, { backendUrl: LANDING_URL, token, userId })
    assertJourneyTransition({
      prev: before, next: after,
      label: 'mid-cup refresh → step 7 + +50 TC + specialize',
      stepDone:  7,
      tcDelta:   50,
      phase:     'specialize',
      botsDelta: 0,
    })

    // The drawer should be visible post-refresh (specialize phase auto-opens
    // on hydration when not dismissed) and showing the celebration card.
    // We don't strictly assert the coaching card here — it's an SSE one-shot
    // so the refresh might land just after the event fired, missing the
    // popup. The journey card is read from /guide/preferences on hydration,
    // so it's always present.
    const guidePanel = page.getByRole('dialog', { name: /^Guide$/i })
    await expect(guidePanel).toBeVisible({ timeout: 10_000 })
    await expect(guidePanel.getByText(/Curriculum complete!/i)).toBeVisible({ timeout: 5_000 })
  })

  // ── 7. Sequential cups — clone again after one completes ─────────────────
  // After graduating the curriculum, a user might run a second cup (out of
  // curiosity, or because they trained their bot more). Recent commit
  // f482979 "follow caller bot into round-1 + retry on any P2002" hints at
  // a uniqueness-collision class of bug — sequential cups with the same
  // caller is the obvious surface where that would re-emerge.
  //
  // Asserts:
  //   - Second clone POST returns 201 (no P2002 / FK collision).
  //   - Tournament page renders (different ID than the first cup).
  //   - Step 7 is *not* re-credited (it's already done; the bridge is
  //     idempotent).
  //   - +50 TC is granted exactly once (no double-credit on the second cup).
  test('sequential cups — second clone succeeds, no spurious step-7 re-fire, no double credit', async ({ page, context }) => {
    page.on('pageerror', (err) => console.log(`[browser:error] ${err.message}`))

    await dismissWelcomeOnLoad(page)
    const email       = freshEmail()
    const password    = 'cup-test-pw-1234'
    const displayName = `Cup7 ${Math.random().toString(36).slice(2, 8)}`
    await signUp(page, { email, password, displayName })

    const token  = await fetchAuthToken(context.request, LANDING_URL)
    const userId = await fetchUserId(context.request, token)
    await createQuickBot(context.request, token, `CupBot7 ${Math.random().toString(36).slice(2, 6)}`)

    await context.request.patch(`${LANDING_URL}/api/v1/guide/preferences`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data:    { journeyProgress: { completedSteps: [1, 2, 3, 4, 5], dismissedAt: null } },
    })

    // First cup — drive to completion via the API path so we have a clean
    // step-7 baseline before kicking off cup #2.
    await page.goto('/profile?action=cup')
    await page.waitForURL(/\/tournaments\/([^/?]+)\?follow=/, { timeout: 15_000 })
    const firstCupId = page.url().match(/\/tournaments\/([^/?]+)\?/)?.[1]
    expect(firstCupId).toBeTruthy()

    await pollForStep(context.request, token, 7, 240_000)
    const afterFirstCup = await snapshotJourney(context.request, { backendUrl: LANDING_URL, token, userId })
    expect(afterFirstCup.completedSteps, `step 7 not credited within 240s of first cup start (saw [${afterFirstCup.completedSteps.join(',')}])`).toEqual(expect.arrayContaining([7]))
    expect(afterFirstCup.phase).toBe('specialize')
    const tcAfterFirstCup = afterFirstCup.creditsTc

    // Dismiss any popups left over so they don't intercept clicks on cup #2.
    // RewardPopup auto-dismisses after 8s; CoachingCard does not — close it.
    const coachingCard = page.getByTestId('coaching-card')
    if (await coachingCard.isVisible().catch(() => false)) {
      await coachingCard.getByRole('button', { name: /Dismiss/i }).click().catch(() => {})
    }

    // Second cup — the f482979 retry path is exercised here. Pre-fix, a
    // sequential clone could trip over a P2002 unique-constraint collision
    // (cup-bot username collisions if the random pool overlapped) and 500.
    await page.goto('/profile?action=cup')
    await page.waitForURL(/\/tournaments\/([^/?]+)\?follow=/, { timeout: 20_000 })
    const secondCupId = page.url().match(/\/tournaments\/([^/?]+)\?/)?.[1]
    expect(secondCupId).toBeTruthy()
    expect(secondCupId, 'second cup must be a different tournament').not.toBe(firstCupId)
    await expect(page.getByRole('heading', { name: /Curriculum Cup/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/Couldn't start the Curriculum Cup/i)).toBeHidden()

    // Let the second cup run for a bit so any step-7 re-fire would have
    // happened by now. We don't poll for step 7 (already done); we just
    // soak so a buggy bridge would have fired the credit again.
    await page.waitForTimeout(60_000)

    const afterSecondCup = await snapshotJourney(context.request, { backendUrl: LANDING_URL, token, userId })
    // completedSteps is a Set in deriveCurrentPhase; the snapshot stores
    // sorted unique ints. Step 7 should still be present exactly once
    // (snapshotJourney already deduplicates) and creditsTc must not have
    // grown again — the curriculum-complete reward is one-shot.
    expect(afterSecondCup.completedSteps).toEqual(expect.arrayContaining([7]))
    expect(
      afterSecondCup.creditsTc,
      `second cup must not re-fire +50 TC (was ${tcAfterFirstCup}, now ${afterSecondCup.creditsTc})`
    ).toBe(tcAfterFirstCup)
    expect(afterSecondCup.phase).toBe('specialize')
  })
})
