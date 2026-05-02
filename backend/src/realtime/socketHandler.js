// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Table lifecycle helpers (formerly the socket.io entry point).
 *
 * Phase 8 of the realtime migration removed socket.io entirely; this file
 * now hosts the SSE-only helpers that the rest of the platform imports
 * from this path. The exports below preserve the shape callers expect so
 * tableFlowService, admin routes, GC, etc. don't have to chase a rename.
 *
 * What lives here:
 *   - `attachSocketIO(server)`      — no-op stub (kept so index.js can
 *     still call it without conditionals during the cut)
 *   - `getSocketAdapterState()`     — returns 'sse' for /admin/health
 *   - `sanitizeTable`, `mapStatus`  — pure helpers used by tableFlowService
 *   - `unregisterTable(tableId)`    — drops watchers when a table is gone
 *   - `clearAllIdleTimersForTable`  — no-op (idle subsystem retired with
 *     the per-socket timer maps)
 *   - `resetIdleForUserInTable`     — no-op (idle/pong POST is now an
 *     idempotent ack so older clients don't error)
 *   - `deleteIfGuestTable`          — DB cleanup of anonymous-host tables
 *   - `dispatchBotMove(table)`      — bot move loop + SSE state emit
 *   - `recordPvpGame(table)`        — game-completion bookkeeping +
 *     tournament series fan-out
 *   - `broadcastTablePresence(io, tableId)` — re-broadcasts presence on
 *     SSE; the `io` arg is accepted for caller compat and ignored
 */

import db from '../lib/db.js'
import { getMoveForModel } from '../services/skillService.js'
import { minimaxMove, getWinner, isBoardFull, WIN_LINES } from '@xo-arena/ai'
import { createGame } from '../services/userService.js'
import { recordGameCompletion } from '../services/creditService.js'
import { updatePlayersEloAfterPvP } from '../services/eloService.js'
import { completeStep as completeJourneyStep } from '../services/journeyService.js'
import { deletePendingPvpMatch } from '../lib/tournamentBridge.js'
import {
  removeAllWatchersForTable,
  getPresence as getTablePresence,
} from './tablePresence.js'
import { dualEmitPresence } from '../services/tablePresenceService.js'
import { appendToStream } from '../lib/eventStream.js'
import { dispatchTableReleased, TABLE_RELEASED_REASONS } from '../lib/tableReleased.js'
import { formatTableLabel } from '../lib/tableLabel.js'
import logger from '../logger.js'

const TOURNAMENT_SERVICE_URL = process.env.TOURNAMENT_SERVICE_URL || 'http://localhost:3001'

// ── Adapter state (kept for /admin/health) ───────────────────────────────────
export function getSocketAdapterState() { return 'sse' }

// ── Presence ─────────────────────────────────────────────────────────────────

/**
 * Re-broadcast the current presence for a table. Spectator count comes
 * from the SSE-side watcher map; legacy callers still pass `io` so the
 * signature is preserved (the arg is ignored).
 */
export function broadcastTablePresence(_io, tableId) {
  const presence = getTablePresence(tableId)
  // Watcher count from the table-presence map IS the spectator count now —
  // the legacy `_spectatorSockets` map died with socket.io.
  const spectatorCount = presence?.userIds?.length ?? 0
  dualEmitPresence(null, tableId, presence, spectatorCount)
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Build the sanitised table payload the frontend expects. */
export function sanitizeTable(table, extras = {}) {
  const ps = table.previewState || {}
  const seats = table.seats || []
  return {
    slug: table.slug,
    label: formatTableLabel(table, extras.viewerId ?? null),
    isHvb: !!table.isHvb,
    isDemo: !!table.isDemo,
    isTournament: !!table.isTournament,
    status: mapStatus(table.status),
    board: ps.board ?? Array(9).fill(null),
    currentTurn: ps.currentTurn ?? 'X',
    scores: ps.scores ?? { X: 0, O: 0 },
    round: ps.round ?? 1,
    winner: ps.winner ?? null,
    winLine: ps.winLine ?? null,
    spectatorCount: 0,
    spectatorAllowed: !table.isPrivate,
    hostUserId: seats[0]?.userId ?? null,
    hostUserDisplayName: extras.hostUserDisplayName ?? seats[0]?.displayName ?? null,
    hostUserElo: extras.hostUserElo ?? null,
    hostUserIsBot: extras.hostUserIsBot ?? false,
    hostUserOwnerBaId: extras.hostUserOwnerBaId ?? null,
    guestUserId: seats[1]?.userId ?? null,
    guestUserDisplayName: extras.guestUserDisplayName ?? seats[1]?.displayName ?? null,
    guestUserElo: extras.guestUserElo ?? null,
    guestUserIsBot: extras.guestUserIsBot ?? false,
    guestUserOwnerBaId: extras.guestUserOwnerBaId ?? null,
  }
}

/** Map DB TableStatus to the frontend's status string. */
export function mapStatus(dbStatus) {
  switch (dbStatus) {
    case 'FORMING':   return 'waiting'
    case 'ACTIVE':    return 'playing'
    case 'COMPLETED': return 'finished'
    default:          return dbStatus
  }
}

function userIdForMark(marks, mark) {
  if (!marks) return null
  return Object.entries(marks).find(([, m]) => m === mark)?.[0] ?? null
}

function hostUserId(seats) { return seats?.[0]?.userId ?? null }
function guestUserId(seats) { return seats?.[1]?.userId ?? null }

// ── Idle subsystem (retired in Phase 8) ──────────────────────────────────────
// The per-socket idle timer machinery died with socket.io. The idle/pong
// POST is now an idempotent ack so older clients don't error, and the
// `clearAll…` sweep is a no-op kept for caller compat.

/** No-op (idle timer subsystem retired in Phase 8). */
export function clearAllIdleTimersForTable(_tableId) { /* no-op */ }

/** No-op idle keep-alive (idle timer subsystem retired in Phase 8). */
export async function resetIdleForUserInTable(_io, _userId, _tableId) {
  return { ok: true, isPlayer: false }
}

// ── Table cleanup ────────────────────────────────────────────────────────────

/**
 * Drop the in-memory watcher map entries for a vanished table. Called by
 * GC sweeps and admin DELETE; kept idempotent so any caller can hit it
 * without checking. Returns an empty array — the legacy form returned the
 * affected sockets, but with socket.io gone there's nothing to enumerate.
 */
export function unregisterTable(tableId) {
  if (!tableId) return []
  removeAllWatchersForTable(tableId)
  return []
}

/**
 * If a table was created by an unauthenticated guest, delete the row.
 *
 * Guest tables (createdById === 'anonymous') are ephemeral — they exist
 * only to give the realtime layer a single primitive to hang a game on.
 * Once the game ends there's no Game record to join back to (recordPvpGame
 * skips all-guest tables), no ELO impact, and no value in keeping the row
 * around. Always best-effort; logs and swallows errors so this can't
 * break the surrounding completion flow.
 */
export async function deleteIfGuestTable(tableOrId) {
  try {
    let tableId, createdById
    if (typeof tableOrId === 'string') {
      const t = await db.table.findUnique({
        where:  { id: tableOrId },
        select: { id: true, createdById: true },
      })
      if (!t) return
      tableId     = t.id
      createdById = t.createdById
    } else if (tableOrId && typeof tableOrId === 'object') {
      tableId     = tableOrId.id
      createdById = tableOrId.createdById
    }
    if (!tableId || createdById !== 'anonymous') return
    await db.table.delete({ where: { id: tableId } })
    dispatchTableReleased(tableId, TABLE_RELEASED_REASONS.GUEST_CLEANUP)
  } catch (err) {
    logger.warn({ err: err.message }, 'deleteIfGuestTable failed')
  }
}

// ── Tournament match completion ──────────────────────────────────────────────

async function completeTournamentMatch(matchId, winnerId, p1Wins, p2Wins, drawGames) {
  try {
    const res = await fetch(`${TOURNAMENT_SERVICE_URL}/api/matches/${matchId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.INTERNAL_SECRET ? { 'x-internal-secret': process.env.INTERNAL_SECRET } : {}),
      },
      body: JSON.stringify({ winnerId, p1Wins, p2Wins, drawGames }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      logger.error({ matchId, status: res.status, body }, 'completeTournamentMatch: non-2xx response')
      return false
    }
    return true
  } catch (err) {
    logger.error({ err, matchId }, 'completeTournamentMatch: fetch failed')
    return false
  }
}

// ── Bot move dispatch ────────────────────────────────────────────────────────

/**
 * Compute and apply the bot's next move on an HvB table, then publish
 * the resulting state on the SSE `table:<id>:state` channel. Legacy
 * callers passed `io` as the second argument; it's accepted and ignored.
 */
export async function dispatchBotMove(table, _io) {
  if (!table.isHvb || table.status !== 'ACTIVE') return

  const ps = table.previewState
  if (!ps) return

  let cellIndex
  try {
    if (table.botSkillId) {
      cellIndex = await getMoveForModel(table.botSkillId, ps.board)
    } else {
      cellIndex = minimaxMove(ps.board, 'master', ps.botMark)
    }
  } catch (err) {
    logger.warn({ err, tableId: table.id }, 'Bot move computation failed, falling back to minimax')
    cellIndex = minimaxMove(ps.board, 'master', ps.botMark)
  }

  const fresh = await db.table.findUnique({ where: { id: table.id } })
  if (!fresh || fresh.status !== 'ACTIVE') return

  const fps = { ...fresh.previewState }
  const botMark = fps.botMark
  if (botMark !== fps.currentTurn) {
    logger.warn({ tableId: table.id }, 'makeBotMove: not bot turn')
    return
  }
  if (fps.board[cellIndex] !== null) {
    logger.warn({ tableId: table.id, cellIndex }, 'makeBotMove: cell occupied')
    return
  }

  fps.board[cellIndex] = botMark
  fps.moves = fps.moves || []
  fps.moves.push({ n: fps.moves.length + 1, m: botMark, c: cellIndex })

  const winner = getWinner(fps.board)
  const draw = !winner && isBoardFull(fps.board)

  let newStatus = 'ACTIVE'
  if (winner) {
    fps.winner = winner.mark ?? winner
    fps.winLine = winner.line ?? WIN_LINES.find(([a, b, c]) =>
      fps.board[a] === fps.winner && fps.board[b] === fps.winner && fps.board[c] === fps.winner
    ) ?? null
    const winMark = fps.winner
    fps.scores[winMark] = (fps.scores[winMark] || 0) + 1
    newStatus = 'COMPLETED'
  } else if (draw) {
    fps.winner = null
    newStatus = 'COMPLETED'
  } else {
    fps.currentTurn = botMark === 'X' ? 'O' : 'X'
  }

  const updated = await db.table.update({
    where: { id: table.id },
    data: { previewState: fps, status: newStatus },
  })

  const movedPayload = {
    cellIndex,
    board: fps.board,
    currentTurn: fps.currentTurn,
    status: mapStatus(newStatus),
    winner: fps.winner,
    winLine: fps.winLine,
    scores: fps.scores,
    round: fps.round ?? 1,
  }
  appendToStream(
    `table:${table.id}:state`,
    { kind: 'moved', ...movedPayload },
    { userId: '*' },
  ).catch(() => {})

  if (newStatus === 'COMPLETED') {
    recordPvpGame(updated).catch((err) => logger.warn({ err }, 'Failed to record HvB game'))
    // Do NOT deleteIfGuestTable here — the guest-table row must persist so
    // the player can Rematch. The session dispose handler cleans it up
    // when the SSE connection closes; the 24h tableGcService sweep is the
    // backstop.
  }
}

// ── Record PvP game ──────────────────────────────────────────────────────────

/**
 * Persist a completed game (PvP, HvB, or tournament series) and fan out
 * series-completion / mid-series-score events on the SSE tournament
 * channels. Legacy callers passed `io`; it's accepted and ignored.
 */
export async function recordPvpGame(table, _io) {
  const seats = table.seats || []
  const ps = table.previewState || {}
  const marks = ps.marks || {}

  const hostBaId = hostUserId(seats)
  const guestBaId = guestUserId(seats)

  if (!hostBaId && !guestBaId) return
  const moveCount = (ps.board || []).filter(Boolean).length
  if (moveCount === 0) return

  const [hostUser, guestUser] = await Promise.all([
    hostBaId  ? db.user.findUnique({ where: { betterAuthId: hostBaId },  select: { id: true } }) : null,
    guestBaId ? db.user.findUnique({ where: { betterAuthId: guestBaId }, select: { id: true } }) : null,
  ])
  const hostDomainId  = hostUser?.id  ?? null
  const guestDomainId = guestUser?.id ?? null

  if (!hostDomainId && !guestDomainId) return

  const isTournamentRoom = !!table.tournamentMatchId
  const totalMoves = (ps.board || []).filter(Boolean).length
  const createdMs = new Date(table.createdAt).getTime()
  const updatedMs = new Date(table.updatedAt).getTime()
  const durationMs = updatedMs - createdMs

  let outcome = 'DRAW'
  if (ps.winner) {
    const winnerIsHost = marks[hostBaId] === ps.winner
    outcome = winnerIsHost ? 'PLAYER1_WIN' : 'PLAYER2_WIN'
  }

  let winnerId = null
  if (ps.winner) {
    const winnerBaId = userIdForMark(marks, ps.winner)
    if (winnerBaId === hostBaId) winnerId = hostDomainId
    else if (winnerBaId === guestBaId) winnerId = guestDomainId
  }

  if (hostDomainId) {
    await createGame({
      player1Id: hostDomainId,
      player2Id: guestDomainId,
      winnerId,
      mode: table.isHvb ? 'HVB' : 'HVH',
      outcome,
      totalMoves,
      durationMs,
      startedAt: new Date(table.createdAt),
      roomName: null,
      tournamentId: table.tournamentId ?? null,
      tournamentMatchId: table.tournamentMatchId ?? null,
      moveStream: ps.moves?.length ? ps.moves : null,
    })
  }

  // Journey step 1 (Hook: Play a PvAI game) — only for human-vs-bot games.
  if (hostDomainId && table.isHvb) completeJourneyStep(hostDomainId, 1).catch(() => {})

  // ELO update (skip for tournament and HvB).
  if (!isTournamentRoom && !table.isHvb && hostDomainId && guestDomainId) {
    updatePlayersEloAfterPvP(hostDomainId, guestDomainId, outcome).catch(() => {})
  }

  if (isTournamentRoom) {
    const xWins = ps.scores?.X ?? 0
    const oWins = ps.scores?.O ?? 0
    const gamesPlayed = ps.round ?? 1
    const drawGames = gamesPlayed - xWins - oWins
    const bestOfN = table.bestOfN ?? 1
    const required = Math.ceil(bestOfN / 2)
    // Majority reached OR max games played (prevents infinite draws — TTT
    // optimal play draws every game). At max with neither at `required`,
    // the side with more wins takes the series; tied wins → X (host).
    const majorityReached = xWins >= required || oWins >= required
    const maxGamesReached = gamesPlayed >= bestOfN
    const seriesDone = majorityReached || maxGamesReached
    logger.info({
      tableId: table.id, tournamentMatchId: table.tournamentMatchId,
      bestOfN, xWins, oWins, required, gamesPlayed,
      majorityReached, maxGamesReached, seriesDone,
    }, 'tournament series check')

    if (seriesDone) {
      const seriesWinnerMark = xWins >= oWins ? 'X' : 'O'
      const seriesWinnerBaId = userIdForMark(marks, seriesWinnerMark)

      let winnerParticipantId = null
      try {
        const winnerUser = seriesWinnerBaId
          ? await db.user.findUnique({ where: { betterAuthId: seriesWinnerBaId }, select: { id: true } })
          : null
        const participant = winnerUser
          ? await db.tournamentParticipant.findFirst({
              where: { tournamentId: table.tournamentId, userId: winnerUser.id },
              select: { id: true },
            })
          : null
        winnerParticipantId = participant?.id ?? null
      } catch (err) {
        logger.warn({ err, tournamentMatchId: table.tournamentMatchId }, 'Could not look up winner participant ID')
      }

      const completed = await completeTournamentMatch(table.tournamentMatchId, winnerParticipantId, xWins, oWins, drawGames)
      if (completed) deletePendingPvpMatch(table.tournamentMatchId)

      const seriesPayload = {
        tournamentId: table.tournamentId,
        matchId: table.tournamentMatchId,
        p1Wins: xWins,
        p2Wins: oWins,
        seriesWinnerUserId: seriesWinnerBaId,
      }
      appendToStream(`tournament:${table.tournamentId}:series:complete`, seriesPayload).catch(() => {})
    } else {
      // Mid-series — persist the score so the bracket updates live.
      db.tournamentMatch.update({
        where: { id: table.tournamentMatchId },
        data: { p1Wins: xWins, p2Wins: oWins, drawGames, status: 'IN_PROGRESS' },
      }).catch(err => logger.warn({ err, tournamentMatchId: table.tournamentMatchId }, 'Failed to update mid-series score'))

      const scorePayload = {
        tournamentId: table.tournamentId,
        matchId: table.tournamentMatchId,
        p1Wins: xWins,
        p2Wins: oWins,
      }
      appendToStream('tournament:match:score', scorePayload).catch(() => {})
    }
    return
  }

  // Free-play credits + accomplishments.
  const pvpParticipants = [
    hostDomainId  ? { userId: hostDomainId,  isBot: false, botOwnerId: null } : null,
    guestDomainId ? { userId: guestDomainId, isBot: table.isHvb ?? false, botOwnerId: null } : null,
  ].filter(Boolean)

  if (pvpParticipants.length > 0) {
    recordGameCompletion({ appId: 'xo-arena', participants: pvpParticipants, mode: table.isHvb ? 'hvb' : 'hvh' })
      .catch((err) => logger.warn({ err }, 'Credit recording failed (non-fatal)'))
  }
}

// ── attachSocketIO stub ──────────────────────────────────────────────────────
//
// Kept so index.js can call it unconditionally during the cut. Returns a
// minimal object with a `to()` method that returns a no-op `emit()` — any
// stale `_io.to(room).emit(...)` paths that survive elsewhere in the
// codebase silently no-op instead of throwing.
export async function attachSocketIO(_httpServer) {
  const noop = () => {}
  return {
    to: () => ({ emit: noop }),
    emit: noop,
    sockets: { sockets: new Map() },
    of: () => ({ to: () => ({ emit: noop }) }),
    on: noop,
  }
}
