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

  // ── Per-step × per-route matrix (task #37) ────────────────────────────────
  // Catches regressions where a future change to the suppression rules
  // breaks any one cell. Each step has a defined open/suppress contract on
  // the four interesting route classes (content vs non-content). Steps 5 +
  // 7 are the documented exceptions: they always open even on content
  // pages because they're end-of-flow signals.
  describe('per-step × per-route matrix', () => {
    const NON_CONTENT_PATHS = [
      { pathname: '/home',                         search: '' },
      { pathname: '/profile',                      search: '' },
      { pathname: '/gym',                          search: '' },
      { pathname: '/rankings',                     search: '' },
      { pathname: '/tournaments',                  search: '' },
      { pathname: '/tournaments/abc',              search: '' },        // listing-detail, no follow
    ]
    const CONTENT_PATHS = [
      { pathname: '/play',                         search: '' },
      { pathname: '/tables/tbl_abc',               search: '' },
      { pathname: '/tournaments/cup-1',            search: '?follow=u1' },
    ]

    for (const step of [1, 2, 3, 4, 6]) {
      it(`step ${step}: opens on every non-content route`, () => {
        for (const r of NON_CONTENT_PATHS) {
          expect(shouldOpenGuideOnJourneyStep({ ...r, step })).toBe(true)
        }
      })
      it(`step ${step}: suppresses on every content route (no exception applies)`, () => {
        for (const r of CONTENT_PATHS) {
          expect(shouldOpenGuideOnJourneyStep({ ...r, step })).toBe(false)
        }
      })
    }

    for (const step of [5, 7]) {
      it(`step ${step} (end-of-flow): opens on EVERY route, content or not`, () => {
        for (const r of [...NON_CONTENT_PATHS, ...CONTENT_PATHS]) {
          expect(shouldOpenGuideOnJourneyStep({ ...r, step })).toBe(true)
        }
      })
    }
  })
})
