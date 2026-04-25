// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Coaching-card decision tree (Intelligent Guide §5.5).
 *
 * Run on Curriculum Cup completion to pick the post-cup card the user sees.
 * The card is purely advisory — its CTA links the user to the next sensible
 * action given how their bot performed and what they've already tried.
 *
 * Branches:
 *   1. CHAMPION       — user's bot won the cup (finalPosition === 1).
 *   2. RUNNER_UP      — user's bot reached the final and lost (finalPosition === 2).
 *   3. ONE_TRAIN_LOSS — user's bot lost in semis BUT they had recently trained
 *                       it (lostInSemis && didTrainImprove). Suggests algorithm
 *                       experimentation rather than more depth.
 *   4. HEAVY_LOSS     — user's bot lost in semis AND hadn't trained, or had
 *                       trained without improvement. Default "train deeper" CTA.
 *
 * v1 note: didTrainImprove is supplied by the caller. Today the bridge passes
 * `false` (placeholder); v1.1 will inspect ML-model history to set it for
 * real. Both ONE_TRAIN_LOSS and HEAVY_LOSS branches ship now so the rules
 * surface is complete and all four CTAs are exercised by tests.
 *
 * Rookie Cup is text-only in v1 (the full bracket ships in v1.1 Sprint 8).
 * The CHAMPION CTA navigates to a static info screen — `/guide/rookie-cup`.
 */

export const COACHING_CARDS = Object.freeze({
  CHAMPION: Object.freeze({
    id:        'champion',
    title:     'Cup Champion!',
    body:      'Your bot took the Curriculum Cup. Ready for tougher opponents?',
    ctaLabel:  'Try Rookie Cup',
    ctaHref:   '/guide/rookie-cup',
  }),
  RUNNER_UP: Object.freeze({
    id:        'runner_up',
    title:     'So close.',
    body:      'You made the final. A deeper bot tier could close the gap.',
    ctaLabel:  'Train your bot deeper',
    ctaHref:   '/profile?action=train',
  }),
  ONE_TRAIN_LOSS: Object.freeze({
    id:        'one_train_loss',
    title:     'Different angle?',
    body:      "Your bot improved with training but didn't break through. A different algorithm might suit your style better.",
    ctaLabel:  'Switch algorithm',
    ctaHref:   '/gym?action=switch-algorithm',
  }),
  HEAVY_LOSS: Object.freeze({
    id:        'heavy_loss',
    title:     'Time to dig in.',
    body:      'A trained bot makes a real difference at this tier. Train yours and try again.',
    ctaLabel:  'Train your bot',
    ctaHref:   '/profile?action=train',
  }),
})

/**
 * Pick the coaching card for a cup completion.
 *
 * @param {object} args
 * @param {number}  args.finalPosition     — 1-based final standing
 * @param {boolean} [args.lostInSemis]     — true when finalPosition > 2 in a 4-bot bracket
 * @param {boolean} [args.didTrainImprove] — true when training between bot creation and the cup demonstrably bumped its tier/skill
 * @returns {object|null} the matching COACHING_CARDS entry, or null when finalPosition is missing
 */
export function pickCoachingCard({ finalPosition, lostInSemis = false, didTrainImprove = false } = {}) {
  if (finalPosition == null) return null

  if (finalPosition === 1) return COACHING_CARDS.CHAMPION
  if (finalPosition === 2) return COACHING_CARDS.RUNNER_UP

  // finalPosition >= 3 — lost in the semis (or earlier in larger brackets)
  if (lostInSemis && didTrainImprove) return COACHING_CARDS.ONE_TRAIN_LOSS
  return COACHING_CARDS.HEAVY_LOSS
}
