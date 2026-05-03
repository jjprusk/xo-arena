// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Demo Table macro — curated allowlist of bot-vs-bot pairings.
 *
 * Lives here (not SystemConfig) because adding/removing a pairing is a brand
 * and quality decision, not an admin-tunable knob. Add a pairing only after
 * verifying the matchup produces watchable games end-to-end.
 *
 * Each entry references built-in bots by `username`. The endpoint resolves
 * the username → user row at request time and uses the live `botModelId`
 * (so a future tier rebalance applies automatically without touching this
 * file). See Intelligent_Guide_Requirements.md §5.1 for rationale per pairing.
 *
 * Adding a new pairing:
 *   1. Run the proposed matchup ≥ 30 times locally
 *   2. Verify ≥ 7 moves on average (no instant draws/wins)
 *   3. Verify outcome distribution feels right for the tier difference
 *   4. Add the line and PR
 */

// Two distinct bots in every entry. Same-bot matchups (Copper vs Copper,
// Sterling vs Sterling) used to live here for "same-tier dynamics" but
// reading "Sterling vs Sterling" with two identical avatars looked broken
// to spectators (and tripped a React duplicate-key warning in the seat
// list). Same-tier dynamics are still observable across the picks below
// — Copper vs Sterling and Sterling vs Magnus are close enough that draws
// and tense end-games are common.
export const DEMO_TABLE_MATCHUPS = [
  // Strong demo — Sterling usually wins, but with visible strategy.
  { x: 'bot-copper',   o: 'bot-sterling' },
  // Tier-difference demo — Copper wins most, occasional Rusty lucky-wins.
  { x: 'bot-rusty',    o: 'bot-copper'   },
  // Wide-gap demo — Sterling dominates Rusty's random play, but the
  // randomness keeps the games varied turn-to-turn.
  { x: 'bot-rusty',    o: 'bot-sterling' },
  // High-tier near-stalemate — Magnus is solved-perfect; Sterling forces
  // most games into draws while showing real defensive technique.
  { x: 'bot-sterling', o: 'bot-magnus'   },
  // Mid-vs-top demo — Magnus exploits Copper's gaps without the full
  // tedium of perfect-vs-random. Common Magnus wins with creative lines.
  { x: 'bot-copper',   o: 'bot-magnus'   },
]

/**
 * Pick a pairing uniformly at random.
 *
 * Pure function (takes an optional rng for tests). Returns the entry shape
 * `{ x, o }` where x and o are bot usernames; caller resolves them to user
 * rows.
 */
export function pickMatchup(rng = Math.random) {
  const idx = Math.floor(rng() * DEMO_TABLE_MATCHUPS.length)
  return DEMO_TABLE_MATCHUPS[idx]
}
