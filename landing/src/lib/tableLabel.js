// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Frontend mirror of backend/src/lib/tableLabel.js.
 *
 * Compute a human-readable label for a sanitised table payload (the shape
 * returned from socketHandler `room:joined` or REST `/api/v1/tables`).
 * Pure function — no fetches, no auth lookups.
 *
 * The two layers must stay in sync; if you change one, change the other.
 */

function shortSlug(slug) {
  if (!slug) return ''
  return String(slug).slice(0, 6)
}

export function formatTableLabel(table, viewerId = null) {
  if (!table) return 'Table'

  const slug = table.slug ?? null

  if (table.isDemo) {
    const a = table.bot1?.displayName ?? table.botA?.displayName ?? 'Bot A'
    const b = table.bot2?.displayName ?? table.botB?.displayName ?? 'Bot B'
    return `Demo · ${a} vs ${b}`
  }

  if (table.isHvb || table.isBotGame) {
    const botName = table.bot2?.displayName ?? table.guestUserDisplayName ?? 'Bot'
    if (viewerId && table.hostUserId === viewerId) {
      return `vs ${botName}`
    }
    const humanName = table.hostUserDisplayName ?? 'Player'
    return `${humanName} vs ${botName}`
  }

  const hostName  = table.hostUserDisplayName ?? null
  const guestName = table.guestUserDisplayName ?? null
  const status    = table.status ?? null

  if (status === 'waiting' || status === 'FORMING' || !table.guestUserId) {
    if (hostName) return `${hostName} · waiting`
    return `Table ${shortSlug(slug)} · waiting`
  }

  if (hostName) return `${hostName} vs ${guestName ?? 'Opponent'}`
  return `Table ${shortSlug(slug)}`
}

export default formatTableLabel
