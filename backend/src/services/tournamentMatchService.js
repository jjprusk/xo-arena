// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * tournamentMatchService — transport-agnostic tournament match table flow.
 *
 * Phase 3 of the Realtime Migration (Realtime_Migration_Plan.md) extracts the
 * body of the legacy `tournament:room:join` socket handler so the same DB
 * mutations run from both the socket transport and the SSE+POST transport
 * (POST /api/v1/rt/tournaments/matches/:id/table).
 *
 * The service is the single source of truth for match-table acquisition:
 * pending-match lookup, participant validation, first-player table create,
 * second-player join + ELO/extras computation. It does NOT touch socket.io
 * or SSE — callers handle their own transport-specific side effects (joining
 * socket rooms, registering session→table membership, broadcasting
 * `room:guestJoined` / `game:start`, starting idle timers, etc.).
 *
 * The "room" in the legacy event name was a Socket.io room; the DB primitive
 * has always been a Table, so the new transport drops the historical "room"
 * naming and uses "table" throughout.
 */
import { nanoid } from 'nanoid'
import db from '../lib/db.js'
import {
  getPendingPvpMatch,
  setPendingPvpMatchSlug,
} from '../lib/tournamentBridge.js'
import { createTableTracked } from '../lib/createTableTracked.js'

export class TournamentMatchError extends Error {
  constructor(code, message) {
    super(message ?? code)
    this.code = code
  }
}

function makePreviewState({ marks, botMark = null }) {
  return {
    board: Array(9).fill(null),
    currentTurn: 'X',
    scores: { X: 0, O: 0 },
    round: 1,
    winner: null,
    winLine: null,
    marks,
    botMark,
    moves: [],
  }
}

/**
 * Acquire the playable Table for a tournament match.
 *
 * Returns either a freshly-created table (first participant to call) or a
 * just-activated table (second participant). The return shape is identical
 * in both cases so callers can branch on `action`.
 *
 *   { action: 'created', slug, mark, tournamentId, matchId, bestOfN, tableId }
 *   { action: 'joined',  slug, mark, tournamentId, matchId, bestOfN, tableId,
 *                        table, previewState, extras }
 *
 * Throws a `TournamentMatchError` with `code` ∈ { NOT_FOUND, NOT_PARTICIPANT,
 * NOT_READY } on the corresponding failures so callers can map to whatever
 * error response their transport prefers.
 *
 * @param {object} args
 * @param {{ id: string|null, betterAuthId: string, displayName: string|null }} args.user
 *   The authenticated user. `id` is the domain User.id (used for ELO
 *   lookups); `betterAuthId` is the BA id stored in seats/marks.
 * @param {string} args.matchId  The TournamentMatch id, from the route param.
 */
export async function joinMatchTable({ user, matchId }) {
  if (!matchId) throw new TournamentMatchError('NOT_FOUND', 'matchId required')
  if (!user?.betterAuthId) throw new TournamentMatchError('NOT_PARTICIPANT', 'authentication required')

  const pending = getPendingPvpMatch(matchId)
  if (!pending) throw new TournamentMatchError('NOT_FOUND', 'Tournament match not found or already started')

  const { tournamentId, participant1UserId, participant2UserId, bestOfN } = pending

  if (user.betterAuthId !== participant1UserId && user.betterAuthId !== participant2UserId) {
    throw new TournamentMatchError('NOT_PARTICIPANT', 'You are not a participant in this match')
  }

  const baId = user.betterAuthId

  if (!pending.slug) {
    // First player — create the table.
    const slug = nanoid(8)
    const marks = { [baId]: 'X' }
    const table = await createTableTracked({
      data: {
        gameId: 'xo',
        slug,
        createdById: baId,
        minPlayers: 2,
        maxPlayers: 2,
        isPrivate: true,
        isTournament: true,
        tournamentMatchId: matchId,
        tournamentId,
        bestOfN: bestOfN ?? 1,
        status: 'FORMING',
        seats: [
          { userId: baId, status: 'occupied', displayName: user.displayName ?? null },
          { userId: null, status: 'empty' },
        ],
        previewState: makePreviewState({ marks }),
      },
    })
    setPendingPvpMatchSlug(matchId, slug)
    return {
      action: 'created',
      slug,
      mark: 'X',
      tournamentId,
      matchId,
      bestOfN: bestOfN ?? 1,
      tableId: table.id,
    }
  }

  // Second player — flip the FORMING table to ACTIVE.
  const slug = pending.slug
  const table = await db.table.findFirst({ where: { slug, status: 'FORMING' } })
  if (!table) throw new TournamentMatchError('NOT_READY', 'Match not ready yet — please try again')

  const ps = { ...table.previewState }
  const marks = { ...(ps.marks || {}) }
  marks[baId] = 'O'
  ps.marks = marks

  const newSeats = [
    table.seats[0],
    { userId: baId, status: 'occupied', displayName: user.displayName ?? null },
  ]

  const updated = await db.table.update({
    where: { id: table.id },
    data: {
      status: 'ACTIVE',
      seats: newSeats,
      previewState: ps,
    },
  })

  // ELO extras for the broadcast `room:guestJoined` payload — domain User.id
  // is required to read the GameElo row. Best-effort: missing rows leave the
  // rating null, which the frontend renders as "—".
  let hostElo = null
  const hostBaId = newSeats[0]?.userId ?? null
  if (hostBaId) {
    const hostUser = await db.user.findUnique({
      where:  { betterAuthId: hostBaId },
      select: { id: true },
    })
    if (hostUser) {
      const eloRow = await db.gameElo.findUnique({
        where: { userId_gameId: { userId: hostUser.id, gameId: 'xo' } },
      })
      hostElo = eloRow?.rating ?? null
    }
  }
  let guestElo = null
  if (user.id) {
    const eloRow = await db.gameElo.findUnique({
      where: { userId_gameId: { userId: user.id, gameId: 'xo' } },
    })
    guestElo = eloRow?.rating ?? null
  }

  const extras = {
    hostUserDisplayName:  newSeats[0]?.displayName ?? null,
    hostUserElo:          hostElo,
    guestUserDisplayName: user.displayName ?? null,
    guestUserElo:         guestElo,
  }

  return {
    action: 'joined',
    slug,
    mark: 'O',
    tournamentId,
    matchId,
    bestOfN: bestOfN ?? 1,
    tableId: updated.id,
    table: updated,
    previewState: ps,
    extras,
  }
}
