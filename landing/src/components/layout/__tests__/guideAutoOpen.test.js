// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect } from 'vitest'
import { shouldOpenGuideOnJourneyStep } from '../guideAutoOpen.js'

describe('shouldOpenGuideOnJourneyStep', () => {
  // ── Default open (non-content pages) ─────────────────────────────────────
  it('opens on /home for any step', () => {
    expect(shouldOpenGuideOnJourneyStep({ pathname: '/home', search: '', step: 3 })).toBe(true)
  })

  it('opens on /tournaments listing (no /<id> path) for any step', () => {
    expect(shouldOpenGuideOnJourneyStep({ pathname: '/tournaments', search: '', step: 6 })).toBe(true)
  })

  it('opens on /tournaments/<id> WITHOUT ?follow=', () => {
    // Public tournament view, not cup spectate — fine to open.
    expect(shouldOpenGuideOnJourneyStep({ pathname: '/tournaments/abc', search: '?tab=bracket', step: 6 })).toBe(true)
  })

  // ── /play and /tables suppression (existing behavior) ────────────────────
  it('does NOT open on /play during pre-spar steps', () => {
    expect(shouldOpenGuideOnJourneyStep({ pathname: '/play', search: '', step: 4 })).toBe(false)
  })

  it('does NOT open on /tables/<id> during pre-spar steps', () => {
    expect(shouldOpenGuideOnJourneyStep({ pathname: '/tables/abc', search: '', step: 4 })).toBe(false)
  })

  it('opens on /play when step 5 lands (spar finished — exception)', () => {
    expect(shouldOpenGuideOnJourneyStep({ pathname: '/play', search: '', step: 5 })).toBe(true)
  })

  // ── Cup spectate suppression (new behavior) ──────────────────────────────
  it('does NOT open on /tournaments/<id>?follow=<userId> for non-step-7 events', () => {
    // The user is mid-cup; the Guide drawer's scrim would crowd out the
    // live game. Suppress until cup completes.
    expect(shouldOpenGuideOnJourneyStep({
      pathname: '/tournaments/cup-1',
      search:   '?follow=user-abc',
      step:     6,
    })).toBe(false)
  })

  it('does NOT open on cup spectate even with no step (e.g. unrelated journeyStep refresh)', () => {
    expect(shouldOpenGuideOnJourneyStep({
      pathname: '/tournaments/cup-1',
      search:   '?follow=user-abc',
      step:     undefined,
    })).toBe(false)
  })

  it('opens on cup spectate when step 7 lands (cup complete — exception)', () => {
    // Step 7 is the cup-end signal; user is now ready for the
    // result/coaching card.
    expect(shouldOpenGuideOnJourneyStep({
      pathname: '/tournaments/cup-1',
      search:   '?follow=user-abc',
      step:     7,
    })).toBe(true)
  })

  it('still suppresses on cup spectate when ?follow= is one of multiple params', () => {
    expect(shouldOpenGuideOnJourneyStep({
      pathname: '/tournaments/cup-1',
      search:   '?tab=bracket&follow=user-abc&utm=foo',
      step:     6,
    })).toBe(false)
  })

  // ── Defensive: missing inputs ────────────────────────────────────────────
  it('treats missing args as non-content (defaults to open)', () => {
    expect(shouldOpenGuideOnJourneyStep()).toBe(true)
    expect(shouldOpenGuideOnJourneyStep({})).toBe(true)
  })
})
