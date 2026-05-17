// Copyright © 2026 Joe Pruskowski. All rights reserved.
//
// Central registry of game slugs. Single source of truth for what game IDs are
// valid platform-wide. All handlers, services, and CLI tools should reference
// these constants rather than hardcoding 'xo' / 'tic-tac-toe' / etc.
//
// The slug rename xo → tic-tac-toe is a multi-step migration:
//   1. A1.4 (this module): GAME_IDS.TIC_TAC_TOE = 'xo' so we match the live DB.
//      LEGACY_SLUG_MAP accepts 'tic-tac-toe' at API boundaries and normalizes
//      to 'xo' for downstream code.
//   2. A1.5 (DB migration): UPDATE all gameId rows from 'xo' → 'tic-tac-toe'
//      atomically. Flip GAME_IDS.TIC_TAC_TOE = 'tic-tac-toe' in the same deploy.
//      LEGACY_SLUG_MAP inverts: 'xo' → 'tic-tac-toe' for the 301-redirect window.
//
// During step 1, both 'xo' and 'tic-tac-toe' are accepted at API boundaries and
// both normalize to the current canonical ('xo' today).

/** Stable game ID constants — use these throughout the codebase. */
export const GAME_IDS = Object.freeze({
  TIC_TAC_TOE: 'xo',           // canonical DB value today; flips to 'tic-tac-toe' in A1.5
  CONNECT_FOUR: 'connect-four', // not yet registered — added when Phase B ships
})

/**
 * The set of game IDs the platform recognizes. Routes / queries that filter by
 * gameId should validate against this set rather than accepting arbitrary input.
 *
 * Today only TTT is registered. Connect Four joins after Phase B ships.
 */
export const REGISTERED_GAME_IDS = new Set([
  GAME_IDS.TIC_TAC_TOE,
])

/** The default game when none is specified (e.g. anonymous Quick Match). */
export const DEFAULT_GAME_ID = GAME_IDS.TIC_TAC_TOE

/**
 * Legacy / alias slugs accepted at API boundaries and normalized to canonical.
 *
 * During the A1.4 → A1.5 transition, callers may send either 'xo' (the current
 * DB value) or 'tic-tac-toe' (the target value). Both should resolve to the
 * same internal game ID. The slug-validator middleware uses this map to
 * normalize before dispatching to handlers.
 *
 * After A1.5 lands, this map inverts: 'tic-tac-toe' becomes canonical and 'xo'
 * is kept as a legacy alias for the 301-redirect window, then dropped.
 */
export const LEGACY_SLUG_MAP = Object.freeze({
  'tic-tac-toe': GAME_IDS.TIC_TAC_TOE, // legacy/future URL form accepted today
})

/**
 * Resolve any incoming slug to its canonical form, or return null if unknown.
 *
 *   resolveGameSlug('xo')          → 'xo'             (canonical today)
 *   resolveGameSlug('tic-tac-toe') → 'xo'             (alias → canonical)
 *   resolveGameSlug('foo')         → null             (unknown)
 */
export function resolveGameSlug(slug) {
  if (REGISTERED_GAME_IDS.has(slug)) return slug
  if (Object.prototype.hasOwnProperty.call(LEGACY_SLUG_MAP, slug)) {
    return LEGACY_SLUG_MAP[slug]
  }
  return null
}

/** All slugs accepted at API boundaries (canonical + aliases). */
export function getAcceptedSlugs() {
  return [...REGISTERED_GAME_IDS, ...Object.keys(LEGACY_SLUG_MAP)]
}
