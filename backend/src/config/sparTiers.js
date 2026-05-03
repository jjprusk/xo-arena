// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Spar tier → opponent system bot mapping (Intelligent Guide §5.2).
 *
 * The Spar flow lets a user pit their own bot against a system bot at one of
 * three named difficulty tiers. Each tier resolves to a specific built-in bot
 * by username (see `prisma/seed.js` BUILT_IN_BOTS):
 *
 *   easy   → bot-rusty    (builtin:minimax:novice       — 1-ply)
 *   medium → bot-copper   (builtin:minimax:intermediate — 3-ply)
 *   hard   → bot-sterling (builtin:minimax:advanced     — 5-ply)
 *
 * Lives here (not SystemConfig) because the tier identity is part of the
 * Curriculum surface — renaming "easy" or pointing it at a different bot is
 * a UX decision, not an admin knob. Mirrors `demoTableMatchups.js` rationale.
 */

export const SPAR_TIERS = ['easy', 'medium', 'hard']

export const SPAR_TIER_TO_BOT_USERNAME = Object.freeze({
  easy:   'bot-rusty',
  medium: 'bot-copper',
  hard:   'bot-sterling',
})

export function isValidSparTier(tier) {
  return SPAR_TIERS.includes(tier)
}

export function botUsernameForTier(tier) {
  return SPAR_TIER_TO_BOT_USERNAME[tier] ?? null
}
