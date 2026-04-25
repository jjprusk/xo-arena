// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Guest-mode journey tracking — Phase 0 (Intelligent Guide v1).
 *
 * Pre-signup visitors accumulate Hook-step progress in localStorage. On
 * successful signup, the client posts the captured timestamps to
 * `POST /api/v1/guide/guest-credit` so the new account starts in
 * Curriculum step 3 with Hook 1+2 already credited.
 *
 * Storage key: `guideGuestJourney`
 * Shape:       { hookStep1CompletedAt?: ISO8601, hookStep2CompletedAt?: ISO8601 }
 *
 * Why localStorage (not server-tracked guest sessions): zero DB rows, no
 * cookies requiring consent banners, no privacy banner needed. Works for
 * 90% case (same device, same browser). See requirements §3.5.2.
 */

const STORAGE_KEY = 'guideGuestJourney'

/** Returns the current guest-journey snapshot, or {} if nothing stored / unavailable. */
export function readGuestJourney() {
  if (typeof window === 'undefined' || !window.localStorage) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return (parsed && typeof parsed === 'object') ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Marks Hook step 1 (played a quick PvAI game) complete for the guest.
 * Idempotent — if step 1 already recorded, the existing timestamp is preserved.
 */
export function recordGuestHookStep1() {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const cur = readGuestJourney()
    if (cur.hookStep1CompletedAt) return  // idempotent
    const next = { ...cur, hookStep1CompletedAt: new Date().toISOString() }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // localStorage write failure is non-fatal — guest credit just won't fire
  }
}

/**
 * Marks Hook step 2 (watched a bot-vs-bot demo for ≥ 2 min) complete.
 * Idempotent.
 */
export function recordGuestHookStep2() {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const cur = readGuestJourney()
    if (cur.hookStep2CompletedAt) return
    const next = { ...cur, hookStep2CompletedAt: new Date().toISOString() }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // non-fatal
  }
}

/**
 * Clears the guest-journey state. Called after a successful guest-credit
 * post-signup so a returning user (different account on same device) doesn't
 * inherit the previous guest's progress.
 */
export function clearGuestJourney() {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // non-fatal
  }
}

/**
 * Returns true if the guest has any pending journey progress that would be
 * worth crediting on signup. Used by SignInModal to decide whether to call
 * `api.guide.guestCredit()` after signup completes.
 */
export function hasGuestProgress() {
  const cur = readGuestJourney()
  return !!(cur.hookStep1CompletedAt || cur.hookStep2CompletedAt)
}
