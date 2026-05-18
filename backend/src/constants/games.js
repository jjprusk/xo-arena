// Copyright © 2026 Joe Pruskowski. All rights reserved.
//
// Central registry of game slugs. Single source of truth for what game IDs are
// valid platform-wide. All handlers, services, and CLI tools should reference
// these constants rather than hardcoding 'tic-tac-toe' / 'xo' / etc.
//
// As of A1.5b the canonical slug is 'tic-tac-toe'. The legacy 'xo' slug is
// accepted at API boundaries and normalized to canonical for the 301-redirect
// deprecation window (dropped in A1.9+).

/** Stable game ID constants — use these throughout the codebase. */
export const GAME_IDS = Object.freeze({
  TIC_TAC_TOE:  'tic-tac-toe',  // canonical slug (A1.5b cutover)
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
 * 'xo' was the canonical slug pre-A1.5b. Kept as an alias so legacy URLs,
 * cached client bundles, and external links continue to resolve. The slug
 * validator middleware uses this map to normalize before dispatching.
 *
 * Removal plan: after A1.9 ships the 301-redirect window and external callers
 * have updated, drop this entry entirely.
 */
export const LEGACY_SLUG_MAP = Object.freeze({
  'xo': GAME_IDS.TIC_TAC_TOE, // legacy slug accepted during deprecation window
})

/**
 * Resolve any incoming slug to its canonical form, or return null if unknown.
 *
 *   resolveGameSlug('tic-tac-toe') → 'tic-tac-toe'   (canonical)
 *   resolveGameSlug('xo')          → 'tic-tac-toe'   (alias → canonical)
 *   resolveGameSlug('foo')         → null            (unknown)
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
