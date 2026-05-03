// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Themed bot-name pools for Curriculum Cup (and Rookie Cup, v1.1).
 *
 * Each Cup clone draws fresh display names from these pools so the user's
 * opponents feel curated rather than reused — "Tarnished Bolt" rather than
 * "Rusty (3)". The pools mirror the metallurgical theme of the built-in
 * personas (Rusty, Copper, Sterling, Magnus) so the user's mental model
 * "Sterling > Copper > Rusty" carries straight into the Cup bracket.
 *
 * Eight names per tier × three tiers = 24 names. Curriculum Cup uses the
 * Rusty + Copper pools (Sterling is reserved for Rookie Cup, §5.8).
 *
 * Pool contents are a brand decision, not an admin knob — kept here in
 * code, not SystemConfig.
 */

export const CURRICULUM_NAME_POOLS = Object.freeze({
  rusty: Object.freeze([
    'Tarnished Bolt',
    'Rusted Hinge',
    'Worn Cog',
    'Pitted Spring',
    'Crusted Pin',
    'Flaking Plate',
    'Oxidized Coil',
    'Brittle Gear',
  ]),
  copper: Object.freeze([
    'Copper Coil',
    'Bronze Vector',
    'Patina Wedge',
    'Verdigris Spire',
    'Tinted Anvil',
    'Burnished Lens',
    'Polished Edge',
    'Hammered Disc',
  ]),
  sterling: Object.freeze([
    'Sterling Knight',
    'Silvered Blade',
    'Argent Crown',
    'Lustrous Vane',
    'Mirror Shard',
    'Quicksilver Arc',
    'Pearl Bishop',
    'Lunar Frost',
  ]),
})

export function poolForTier(tier) {
  return CURRICULUM_NAME_POOLS[tier] ?? null
}

/**
 * Pick `count` distinct names from the named tier's pool. Throws if the
 * pool isn't large enough to satisfy the request — fail loud rather than
 * draw with replacement and silently ship duplicates.
 *
 * `rng` is injectable for deterministic tests; defaults to Math.random.
 */
export function pickNames(tier, count, rng = Math.random) {
  const pool = poolForTier(tier)
  if (!pool) throw new Error(`Unknown name-pool tier: ${tier}`)
  if (count > pool.length) {
    throw new Error(`Pool '${tier}' has ${pool.length} names; cannot draw ${count}`)
  }
  const remaining = [...pool]
  const out = []
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rng() * remaining.length)
    out.push(remaining.splice(idx, 1)[0])
  }
  return out
}
