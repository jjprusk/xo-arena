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

export const DEMO_TABLE_MATCHUPS = [
  // Strong demo — Sterling usually wins, but with visible strategy.
  { x: 'bot-copper',   o: 'bot-sterling' },
  // Tier-difference demo — Copper wins most, occasional Rusty lucky-wins.
  { x: 'bot-rusty',    o: 'bot-copper'   },
  // Same-tier blocking dance — draws common, demonstrates strategic layer.
  { x: 'bot-copper',   o: 'bot-copper'   },
  // High-tier draw stalemate — XO is solved at near-perfect play.
  { x: 'bot-sterling', o: 'bot-sterling' },
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
