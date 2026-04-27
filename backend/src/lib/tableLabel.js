// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Compute a human-readable label for a Table row.
 *
 * Pure function — no DB access. Pass an already-loaded Table (or a
 * sanitised payload) plus the viewer's user id. Bot/user names come from
 * the seats array (`seats[i].displayName`) or extras passed in by the
 * caller; the helper never queries.
 *
 * Branches:
 *   - HvB                  → "vs <BotName>"
 *   - PvP FORMING          → "<HostName> · waiting"
 *   - PvP ACTIVE/COMPLETED → "<HostName> vs <OpponentName>"
 *   - Tournament           → "<HostName> vs <OpponentName>" (round info handled by UI)
 *   - Demo                 → "Demo · <BotA> vs <BotB>"
 *   - Fallback             → "Table <slug.slice(0,6)>"
 *
 * The label is informational only — never use it as a key or for routing.
 */

function nameForSeat(seat, fallback = null) {
  if (!seat) return fallback
  return seat.displayName ?? fallback
}

function shortSlug(slug) {
  if (!slug) return ''
  return String(slug).slice(0, 6)
}

export function formatTableLabel(table, viewerId = null) {
  if (!table) return 'Table'

  const seats = Array.isArray(table.seats) ? table.seats : []
  const slug  = table.slug ?? null

  if (table.isDemo) {
    const a = nameForSeat(seats[0], 'Bot A')
    const b = nameForSeat(seats[1], 'Bot B')
    return `Demo · ${a} vs ${b}`
  }

  if (table.isHvb) {
    // Bot seat is whichever doesn't match the viewer; default to seat 1
    // (the bot is always seated on the second seat for HvB tables).
    const botSeat   = seats[1] ?? null
    const humanSeat = seats[0] ?? null
    const botName   = nameForSeat(botSeat, 'Bot')
    if (viewerId && humanSeat?.userId === viewerId) {
      return `vs ${botName}`
    }
    const humanName = nameForSeat(humanSeat, 'Player')
    return `${humanName} vs ${botName}`
  }

  // PvP / tournament
  const hostName  = nameForSeat(seats[0], null)
  const guestSeat = seats[1] ?? null
  const status    = table.status ?? null

  if (status === 'FORMING' || guestSeat?.status !== 'occupied') {
    if (hostName) return `${hostName} · waiting`
    return `Table ${shortSlug(slug)} · waiting`
  }

  const guestName = nameForSeat(guestSeat, 'Opponent')
  if (hostName) return `${hostName} vs ${guestName}`
  return `Table ${shortSlug(slug)}`
}

export default formatTableLabel
