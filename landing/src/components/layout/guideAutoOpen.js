// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Decision helper for the Guide panel's auto-open behavior on
 * `guide:journeyStep` SSE events.
 *
 * The Guide drawer mounts a backdrop scrim that dims the page, so we don't
 * want it popping on top of an experience the user is mid-flow on. Three
 * paths are "content" pages where suppression matters:
 *   - /play, /tables/<id>      — live PvP / spar / demo board
 *   - /tournaments/<id>?follow=…  — cup spectate (user is watching their bot)
 *
 * Two step values override the suppression because they ARE the end-of-flow
 * signals:
 *   - step 5  — Curriculum spar finished (fires only on series completion)
 *   - step 7  — Curriculum Cup completed
 *
 * Pure function so it can be unit-tested without rendering AppLayout.
 *
 * @param {object} args
 * @param {string} args.pathname — window.location.pathname
 * @param {string} args.search   — window.location.search (includes leading '?')
 * @param {number} [args.step]   — payload.step from the SSE event
 * @returns {boolean} true if the panel should auto-open
 */
export function shouldOpenGuideOnJourneyStep({ pathname, search, step } = {}) {
  const path        = pathname ?? ''
  const qs          = search ?? ''
  const onPlayLike  = path.startsWith('/play') || path.startsWith('/tables/')
  const onCupSpect  = path.startsWith('/tournaments/') && qs.includes('follow=')
  const onContent   = onPlayLike || onCupSpect
  const sparDone    = step === 5
  const cupDone     = step === 7
  return !onContent || sparDone || cupDone
}
