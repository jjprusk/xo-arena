// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * journeyAssert — DB-consistency snapshot + transition assertions for the
 * Intelligent Guide v1 journey.
 *
 * Why this exists: end-to-end specs walk all 7 steps and assert *after* each
 * one that `completedSteps.includes(N)`. That's the bare minimum and lets
 * lots of regressions slide through:
 *
 *   - Step regression  — completedSteps shrinks across calls
 *   - Future-step leak — step 5 lands when only 3 was supposed to fire
 *   - Bad credit delta — Hook reward fires at the wrong step, or twice
 *   - Phase drift     — completedSteps says curriculum but server returns hook
 *   - Bot side-effect — train-guided "succeeds" but botModelType never flips
 *
 * snapshotJourney() takes one API-only read of progress + credits + owned
 * bots; assertJourneyTransition() compares two snapshots and the expected
 * delta. Both are pure-data — no Playwright, no Prisma — so they slot into
 * any spec that already has a token + userId.
 *
 * Mirrors `backend/src/services/journeyService.js`:
 *   - HOOK_REWARD_STEP       = 2  (+20 TC)
 *   - CURRICULUM_REWARD_STEP = 7  (+50 TC, terminal)
 *   - deriveCurrentPhase     = pure mapper from completedSteps → phase
 */

export const HOOK_REWARD_STEP        = 2
export const CURRICULUM_REWARD_STEP  = 7
export const TOTAL_STEPS             = 7

/**
 * Pure phase mapper — must match `journeyService.deriveCurrentPhase`.
 */
export function deriveCurrentPhase(completedSteps = []) {
  const done = new Set(completedSteps)
  if (done.has(CURRICULUM_REWARD_STEP)) return 'specialize'
  if (done.has(HOOK_REWARD_STEP))       return 'curriculum'
  return 'hook'
}

/**
 * Capture journey-relevant state for the signed-in user.
 *
 * Reads three endpoints in parallel:
 *   GET /api/v1/guide/preferences        → completedSteps, dismissedAt
 *   GET /api/v1/users/:id/credits        → creditsTc
 *   GET /api/v1/bots/mine                → user-owned bot list (for step 3/4 checks)
 *
 * All endpoints are auth'd; failures degrade to neutral defaults so an
 * intermittent 503 doesn't crash the snapshot — assertions on the missing
 * data will surface the real problem.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {{ backendUrl: string, token: string, userId: string }} ctx
 */
export async function snapshotJourney(request, { backendUrl, token, userId }) {
  const headers = { Authorization: `Bearer ${token}` }
  const [progressRes, creditsRes, botsRes] = await Promise.all([
    request.get(`${backendUrl}/api/v1/guide/preferences`,        { headers }),
    request.get(`${backendUrl}/api/v1/users/${userId}/credits`,  { headers }),
    request.get(`${backendUrl}/api/v1/bots/mine`,                { headers }),
  ])

  const progressBody = progressRes.ok() ? await progressRes.json() : {}
  const completedSteps = progressBody?.preferences?.journeyProgress?.completedSteps
                      ?? progressBody?.journeyProgress?.completedSteps
                      ?? []

  const creditsBody = creditsRes.ok() ? await creditsRes.json() : {}
  const creditsTc   = creditsBody?.creditsTc ?? creditsBody?.tc ?? null

  const botsBody = botsRes.ok() ? await botsRes.json() : {}
  const bots = (botsBody?.bots ?? []).map(b => ({
    id:           b.id,
    displayName:  b.displayName,
    botModelId:   b.botModelId   ?? null,
    botModelType: b.botModelType ?? null,
  }))

  const sortedSteps = [...new Set(completedSteps)].sort((a, b) => a - b)
  return {
    completedSteps: sortedSteps,
    creditsTc,
    bots,
    phase:       deriveCurrentPhase(sortedSteps),
    capturedAt:  Date.now(),
  }
}

/**
 * Assert a step transition is consistent. Throws an Error with a labeled
 * message — Playwright surfaces it just like a failed `expect`.
 *
 * Required: { prev, next, label }
 * Optional shape:
 *   {
 *     stepDone:     number,     // expected to be present in next.completedSteps
 *     tcDelta:      number,     // minimum Δ creditsTc (next - prev) must satisfy
 *     phase:        string,     // expected next.phase ('hook'|'curriculum'|'specialize')
 *     botsDelta:    number,     // expected change in owned-bot count (e.g. +1 at step 3)
 *     qlearningBot: string,     // bot id that must have flipped to qlearning + UUID model id
 *   }
 *
 * Always-on invariants (regardless of opts):
 *   - Every step in prev.completedSteps must still be in next.completedSteps
 *     (no journey regression).
 *   - Every step in next.completedSteps must be in [1..TOTAL_STEPS].
 *   - next.phase must match deriveCurrentPhase(next.completedSteps) (pure-fn
 *     guard against the snapshot helper drifting).
 */
export function assertJourneyTransition({
  prev, next, label = 'step',
  stepDone, tcDelta, phase, botsDelta, qlearningBot,
}) {
  if (!prev || !next) throw new Error(`[${label}] missing prev/next snapshot`)

  // 1. Monotonic: nothing in prev may drop out of next.
  const prevSet = new Set(prev.completedSteps)
  const nextSet = new Set(next.completedSteps)
  for (const s of prevSet) {
    if (!nextSet.has(s)) {
      throw new Error(
        `[${label}] step regression: ${s} was complete pre-action but missing post-action ` +
        `(prev=[${prev.completedSteps.join(',')}], next=[${next.completedSteps.join(',')}])`
      )
    }
  }

  // 2. Range sanity — no future-step leak / no out-of-range index.
  for (const s of nextSet) {
    if (!Number.isInteger(s) || s < 1 || s > TOTAL_STEPS) {
      throw new Error(`[${label}] invalid step ${s} in completedSteps`)
    }
  }

  // 3. Phase derivation must be self-consistent.
  const derived = deriveCurrentPhase(next.completedSteps)
  if (next.phase !== derived) {
    throw new Error(`[${label}] snapshot phase '${next.phase}' disagrees with deriveCurrentPhase = '${derived}'`)
  }

  // 4. Expected step landed.
  if (stepDone != null && !nextSet.has(stepDone)) {
    throw new Error(
      `[${label}] expected step ${stepDone} complete post-action; got [${next.completedSteps.join(',')}]`
    )
  }

  // 5. Phase match (caller-asserted).
  if (phase != null && next.phase !== phase) {
    throw new Error(`[${label}] expected phase '${phase}'; saw '${next.phase}'`)
  }

  // 6. Credit delta. Use min-delta semantics: we accept higher (tester may
  //    have tuned guide.rewards.* upward) but anything less is a regression.
  if (tcDelta != null && prev.creditsTc != null && next.creditsTc != null) {
    const actual = next.creditsTc - prev.creditsTc
    if (actual < tcDelta) {
      throw new Error(
        `[${label}] expected creditsTc to grow by at least ${tcDelta}; ` +
        `saw +${actual} (prev=${prev.creditsTc}, next=${next.creditsTc})`
      )
    }
  }

  // 7. Owned-bot delta — exact match (a step that creates 1 bot must not
  //    silently create 2, even if both are valid quick bots).
  if (botsDelta != null) {
    const grew = next.bots.length - prev.bots.length
    if (grew !== botsDelta) {
      throw new Error(
        `[${label}] expected owned-bot count Δ=${botsDelta}; saw Δ=${grew} ` +
        `(prev=${prev.bots.length}, next=${next.bots.length})`
      )
    }
  }

  // 8. QL training swap: the bot row must have botModelType='qlearning' and
  //    botModelId pointing at a real BotSkill UUID (not the builtin: or
  //    user: minimax form). This catches a class of train-guided regressions
  //    where finalize 200s but the User row never gets repointed.
  if (qlearningBot) {
    const target = next.bots.find(b => b.id === qlearningBot)
    if (!target) {
      throw new Error(`[${label}] bot ${qlearningBot} not found in owned bots [${next.bots.map(b => b.id).join(',')}]`)
    }
    if (target.botModelType !== 'qlearning') {
      throw new Error(
        `[${label}] expected bot ${target.id} botModelType='qlearning'; saw '${target.botModelType}'`
      )
    }
    if (!target.botModelId || /^builtin:|^user:/.test(target.botModelId)) {
      throw new Error(
        `[${label}] expected bot ${target.id} botModelId to be a BotSkill UUID; saw '${target.botModelId}'`
      )
    }
  }
}
