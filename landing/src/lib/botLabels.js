// Copyright © 2026 Joe Pruskowski. All rights reserved.
//
// Phase 3.8.A.3 — Mixed-list bot label disambiguation.
//
// Bot names are unique within an owner and globally for unowned (built-in)
// bots, but cross-owner collisions ARE allowed (Joe and Alice can each
// own a bot named "Rusty"). In any list that mixes owners — leaderboards,
// pickers, brackets — display labels carry a suffix to disambiguate the
// collision: "Rusty · @joe" / "Rusty · built-in".
//
// We only attach the suffix when the name actually collides in the visible
// set, so single-source lists (e.g. /profile own-bot list) stay clean.

/**
 * Compute display labels for a list of bots.
 *
 * @param {Array<{ id: string, displayName: string, botOwnerId?: string|null, ownerUsername?: string|null }>} bots
 * @param {object} [options]
 * @param {string} [options.viewerUserId]  — when provided, the viewer's own bots
 *                                            get the "@you" suffix instead of
 *                                            "@<username>".
 * @returns {Map<string, string>} botId → label
 */
export function disambiguateBotLabels(bots, { viewerUserId } = {}) {
  const labels = new Map()
  if (!Array.isArray(bots) || bots.length === 0) return labels

  const lowerNameCounts = new Map()
  for (const b of bots) {
    if (!b?.displayName) continue
    const k = String(b.displayName).toLowerCase()
    lowerNameCounts.set(k, (lowerNameCounts.get(k) || 0) + 1)
  }

  for (const b of bots) {
    if (!b?.id) continue
    const name = b.displayName ?? ''
    const lower = name.toLowerCase()
    const colliding = lowerNameCounts.get(lower) > 1
    if (!colliding) {
      labels.set(b.id, name)
      continue
    }
    labels.set(b.id, `${name} · ${ownerSuffix(b, viewerUserId)}`)
  }
  return labels
}

/**
 * Single-bot variant — useful when rendering a row in isolation but the
 * caller already knows whether the name collides in its parent list (for
 * example because the parent computed the count once).
 */
export function botLabelWithSuffix(bot, { viewerUserId } = {}) {
  if (!bot?.displayName) return ''
  return `${bot.displayName} · ${ownerSuffix(bot, viewerUserId)}`
}

function ownerSuffix(bot, viewerUserId) {
  if (!bot.botOwnerId) return 'built-in'
  if (viewerUserId && bot.botOwnerId === viewerUserId) return '@you'
  if (bot.ownerUsername) return `@${bot.ownerUsername}`
  return '@user'
}
