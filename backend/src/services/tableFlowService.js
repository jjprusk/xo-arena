// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * tableFlowService — transport-agnostic table game flow.
 *
 * Phase 7b of the Realtime Migration (Realtime_Migration_Plan.md) extracts
 * the game-flow handler bodies out of socketHandler.js so the same code
 * path runs whether the request arrived as a `socket.emit('game:move')` or
 * as `POST /api/v1/rt/tables/:slug/move`.
 *
 * What lives here:
 *   - Pure DB validation + mutation for moves, forfeits, rematches, leaves,
 *     reactions, and table create/cancel/join.
 *   - Dual-emit broadcast: every server→client event goes through both
 *     `io.to('table:<id>').emit(...)` (legacy) AND
 *     `appendToStream('table:<id>:<topic>', payload, { userId: '*' })` (SSE).
 *
 * What stays in socketHandler.js:
 *   - Per-socket bookkeeping: `_socketToTable`, `_socketToUser`,
 *     `_disconnectTimers`, `_idleTimers` keyed on socket.id.
 *   - `socket.emit(...)` for personal one-shots like `room:created` (those
 *     become `appendToStream('user:<id>:table:created', ...)` on the SSE
 *     side — handled in the route caller, not here).
 *   - `socket.join('table:<id>')` and the idle-timer restart loops.
 *
 * Service functions return `{ ok, code?, payload? }` (or richer per-shape
 * objects). The caller decides how to surface errors — legacy socket emits
 * `error: { message }`, the rt route emits an HTTP error response.
 */
import db from '../lib/db.js'
import { nanoid } from 'nanoid'
import { appendToStream } from '../lib/eventStream.js'
import { releaseSeats, releaseSeatForUser } from '../lib/tableSeats.js'
import { dispatchTableReleased, TABLE_RELEASED_REASONS } from '../lib/tableReleased.js'
import { dualEmitLifecycle } from './tablePresenceService.js'
import { deletePendingPvpMatch } from '../lib/tournamentBridge.js'
import { createTableTracked } from '../lib/createTableTracked.js'
import { formatTableLabel } from '../lib/tableLabel.js'
import { resolveSkillForGame } from './skillService.js'
import { getWinner, isBoardFull, WIN_LINES } from '@xo-arena/ai'
import logger from '../logger.js'

/**
 * Build a fresh previewState blob for a new table. Mirrors
 * socketHandler.js::makePreviewState exactly.
 */
function makePreviewState({ marks, botMark = null }) {
  return {
    board: Array(9).fill(null),
    currentTurn: 'X',
    scores: { X: 0, O: 0 },
    round: 1,
    winner: null,
    winLine: null,
    marks,
    ...(botMark ? { botMark } : {}),
    moves: [],
  }
}

// socketHandler.js exports several helpers we need (broadcastTablePresence,
// clearAllIdleTimersForTable, deleteIfGuestTable, recordPvpGame,
// dispatchBotMove, mapStatus). These are imported lazily via dynamic import
// at first call to avoid a module-init circular: socketHandler imports the
// service to delegate handler bodies, so we can't import socketHandler at
// the top of this file. Lazy import is fine — each function is only called
// from inside an event handler / route, never at module init.
let _socketHandlerHelpers = null
async function getSocketHandlerHelpers() {
  if (!_socketHandlerHelpers) {
    _socketHandlerHelpers = await import('../realtime/socketHandler.js')
  }
  return _socketHandlerHelpers
}

// Reactions match the legacy socket handler's whitelist. Anything else is
// silently dropped — same behavior as the prior implementation.
export const ALLOWED_REACTIONS = ['👍', '😂', '😮', '🔥', '😭', '🤔', '👏', '💀']

/**
 * Helper: locate a userId for a table from a callback-provided resolver.
 *
 * Both transports look up "which userId is making this call?" differently:
 *   - Socket: `_socketToUser.get(socket.id)`, falling back to seats heuristic.
 *   - SSE+POST: `req.auth.userId` resolved to domain User.id.
 *
 * The service expects the caller to do that resolution and pass `userId`.
 */

/**
 * Send an emoji reaction. Broadcasts to everyone at the table on both
 * transports. Caller can pass `excludeSocket` so the legacy socket path
 * uses `socket.to(...)` (everyone except the sender) — the SSE broadcast
 * unconditionally goes to all watchers; the sender's UI dedupes.
 */
export async function sendReaction({ io, excludeSocket = null, tableId, userId, emoji }) {
  if (!ALLOWED_REACTIONS.includes(emoji)) return { ok: false, code: 'INVALID_EMOJI' }
  if (!tableId) return { ok: false, code: 'NOT_IN_TABLE' }

  const table = await db.table.findUnique({ where: { id: tableId } })
  if (!table) return { ok: false, code: 'TABLE_NOT_FOUND' }

  const ps = table.previewState || {}
  const fromMark = ps.marks?.[userId] ?? 'spectator'
  const payload = { emoji, fromMark }

  if (io) {
    if (excludeSocket) excludeSocket.to(`table:${tableId}`).emit('game:reaction', payload)
    else               io.to(`table:${tableId}`).emit('game:reaction', payload)
  }
  appendToStream(`table:${tableId}:reaction`, payload, { userId: '*' }).catch(() => {})

  return { ok: true, payload }
}

/**
 * Player clicks Leave Table after a game has finished. Notifies remaining
 * players and frees the leaver's seat. The game itself is already
 * COMPLETED; this only updates the seats blob and emits the lifecycle.
 */
export async function leaveGame({ io, excludeSocket = null, tableId, userId }) {
  if (!tableId) return { ok: false, code: 'NOT_IN_TABLE' }

  // Notify the rest of the table on both transports.
  if (io) {
    if (excludeSocket) excludeSocket.to(`table:${tableId}`).emit('game:opponent_left')
    else               io.to(`table:${tableId}`).emit('game:opponent_left')
  }
  appendToStream(
    `table:${tableId}:lifecycle`,
    { kind: 'opponent_left' },
    { userId: '*' },
  ).catch(() => {})

  // Free this user's seat. The row is already COMPLETED at this point.
  try {
    const table = await db.table.findUnique({
      where:  { id: tableId },
      select: { seats: true },
    })
    if (!table) return { ok: false, code: 'TABLE_NOT_FOUND' }
    if (!userId) return { ok: false, code: 'NOT_A_PLAYER' }
    await db.table.update({
      where: { id: tableId },
      data:  { seats: releaseSeatForUser(table.seats, userId) },
    })
  } catch (err) {
    logger.warn({ err: err.message, tableId }, 'leaveGame: failed to release seat')
    // Non-fatal — the lifecycle event already went out.
  }

  return { ok: true }
}

/**
 * Cancel a FORMING table — host clicked Leave before a guest joined. Marks
 * the row COMPLETED, frees seats, fires `room:cancelled` lifecycle on both
 * transports, and runs the released-table cleanup. Caller is expected to
 * handle the per-socket bookkeeping (idle timers, _socketToTable cleanup).
 */
export async function cancelTable({ io, tableId }) {
  if (!tableId) return { ok: false, code: 'NOT_IN_TABLE' }

  const table = await db.table.findUnique({ where: { id: tableId } })
  if (table) {
    await db.table.update({
      where: { id: tableId },
      data:  { status: 'COMPLETED', seats: releaseSeats(table.seats) },
    }).catch(() => {})
    dispatchTableReleased(tableId, TABLE_RELEASED_REASONS.LEAVE, { trigger: 'room-cancel' })
    const { deleteIfGuestTable } = await getSocketHandlerHelpers()
    await deleteIfGuestTable(table)
    if (table.tournamentMatchId) deletePendingPvpMatch(table.tournamentMatchId)
  }

  dualEmitLifecycle(io, tableId, 'cancelled')
  const { broadcastTablePresence, clearAllIdleTimersForTable } = await getSocketHandlerHelpers()
  broadcastTablePresence(io, tableId)  // F8 — final spectator refresh before unregister
  clearAllIdleTimersForTable(tableId)

  return { ok: true }
}

/**
 * Apply a player's move. Validates turn, applies the move to previewState,
 * detects win/draw, persists, and dual-emits `game:moved`. On COMPLETED,
 * fires recordPvpGame side-effects. On HvB tables, dispatches the bot's
 * follow-up move.
 *
 * Returns `{ ok, code? }` so the caller can map errors to the appropriate
 * transport (socket emits `error: { message }`, rt emits HTTP 4xx).
 */
export async function applyMove({ io, tableId, userId, cellIndex }) {
  if (!tableId)                                   return { ok: false, code: 'NOT_IN_TABLE',     message: 'Not in a room' }
  const table = await db.table.findUnique({ where: { id: tableId } })
  if (!table)                                      return { ok: false, code: 'TABLE_NOT_FOUND', message: 'Room not found' }
  if (table.status !== 'ACTIVE')                   return { ok: false, code: 'NOT_ACTIVE',      message: 'Game not in progress' }

  const ps = { ...table.previewState }
  const marks = ps.marks || {}
  if (!userId)                                     return { ok: false, code: 'NOT_A_PLAYER',    message: 'Not a player in this room' }
  const playerMark = marks[userId]
  if (!playerMark)                                 return { ok: false, code: 'NOT_A_PLAYER',    message: 'Not a player in this room' }
  if (playerMark !== ps.currentTurn)               return { ok: false, code: 'NOT_YOUR_TURN',   message: 'Not your turn' }
  if (ps.board[cellIndex] !== null)                return { ok: false, code: 'CELL_OCCUPIED',   message: 'Cell already occupied' }

  ps.board[cellIndex] = playerMark
  ps.moves = ps.moves || []
  ps.moves.push({ n: ps.moves.length + 1, m: playerMark, c: cellIndex })

  const winner = getWinner(ps.board)
  const draw = !winner && isBoardFull(ps.board)

  let newStatus = table.status
  if (winner) {
    ps.winner = winner.mark ?? winner
    ps.winLine = winner.line ?? WIN_LINES.find(([a, b, c]) =>
      ps.board[a] === ps.winner && ps.board[b] === ps.winner && ps.board[c] === ps.winner
    ) ?? null
    const winMark = ps.winner
    ps.scores[winMark] = (ps.scores[winMark] || 0) + 1
    newStatus = 'COMPLETED'
  } else if (draw) {
    ps.winner = null
    newStatus = 'COMPLETED'
  } else {
    ps.currentTurn = playerMark === 'X' ? 'O' : 'X'
  }

  const updated = await db.table.update({
    where: { id: tableId },
    data:  { previewState: ps, status: newStatus },
  })

  const { mapStatus, clearAllIdleTimersForTable, broadcastTablePresence, recordPvpGame, dispatchBotMove } =
    await getSocketHandlerHelpers()

  const movedPayload = {
    cellIndex,
    board:       ps.board,
    currentTurn: ps.currentTurn,
    status:      mapStatus(newStatus),
    winner:      ps.winner,
    winLine:     ps.winLine,
    scores:      ps.scores,
    round:       ps.round ?? 1,
  }
  if (io) io.to(`table:${tableId}`).emit('game:moved', movedPayload)
  appendToStream(`table:${tableId}:state`, { kind: 'moved', ...movedPayload }, { userId: '*' }).catch(() => {})

  if (newStatus === 'COMPLETED') {
    clearAllIdleTimersForTable(tableId)
    dispatchTableReleased(tableId, TABLE_RELEASED_REASONS.GAME_END, { trigger: 'game-move' })
    broadcastTablePresence(io, tableId)
    recordPvpGame(updated, io).catch((err) => logger.warn({ err }, 'Failed to record PvP game'))
    return { ok: true, completed: true, table: updated, mark: playerMark }
  }

  if (table.isHvb) {
    dispatchBotMove(updated, io).catch((err) => logger.warn({ err }, 'Failed to dispatch bot move'))
  }
  return { ok: true, completed: false, table: updated, mark: playerMark }
}

/**
 * Forfeit by the calling player. Marks game COMPLETED, awards the win to
 * the opponent, releases the forfeiter's seat, dual-emits `game:forfeit`.
 */
export async function forfeitGame({ io, tableId, userId }) {
  if (!tableId)            return { ok: false, code: 'NOT_IN_TABLE' }
  const table = await db.table.findUnique({ where: { id: tableId } })
  if (!table)              return { ok: false, code: 'TABLE_NOT_FOUND' }

  const ps = { ...table.previewState }
  const seats = table.seats || []
  if (!userId)             return { ok: false, code: 'NOT_A_PLAYER' }
  const mark = ps.marks?.[userId]
  if (!mark)               return { ok: false, code: 'NOT_A_PLAYER' }

  const oppMark = mark === 'X' ? 'O' : 'X'
  ps.winner = oppMark
  ps.scores[oppMark] = (ps.scores[oppMark] || 0) + 1

  const updated = await db.table.update({
    where: { id: tableId },
    data:  {
      status:       'COMPLETED',
      previewState: ps,
      seats:        releaseSeatForUser(seats, userId),
    },
  })

  const { clearAllIdleTimersForTable, broadcastTablePresence, recordPvpGame, deleteIfGuestTable } =
    await getSocketHandlerHelpers()

  clearAllIdleTimersForTable(tableId)

  const forfeitPayload = { forfeiterMark: mark, winner: oppMark, scores: ps.scores }
  if (io) io.to(`table:${tableId}`).emit('game:forfeit', forfeitPayload)
  appendToStream(`table:${tableId}:state`, { kind: 'forfeit', ...forfeitPayload }, { userId: '*' }).catch(() => {})

  dispatchTableReleased(tableId, TABLE_RELEASED_REASONS.LEAVE, { trigger: 'forfeit' })
  broadcastTablePresence(io, tableId)
  recordPvpGame(updated, io).catch((err) => logger.warn({ err }, 'Failed to record PvP forfeit game'))
  deleteIfGuestTable(updated).catch(() => {})

  return { ok: true, mark, oppMark, table: updated }
}

/**
 * Start a fresh game on a finished table — same players, alternating who
 * goes first, scores carried forward, round incremented. Dual-emits
 * `game:start` and dispatches the bot opening if HvB.
 */
export async function rematchGame({ io, tableId }) {
  if (!tableId)                                   return { ok: false, code: 'NOT_IN_TABLE',     message: 'Room not found' }
  const table = await db.table.findUnique({ where: { id: tableId } })
  if (!table)                                      return { ok: false, code: 'TABLE_NOT_FOUND', message: 'Room not found' }
  if (table.status !== 'COMPLETED')                return { ok: false, code: 'NOT_COMPLETED',   message: 'Game not finished' }

  const ps = { ...table.previewState }
  ps.board = Array(9).fill(null)
  ps.currentTurn = ps.currentTurn === 'X' ? 'O' : 'X'
  ps.winner = null
  ps.winLine = null
  ps.moves = []
  ps.round = (ps.round || 1) + 1
  logger.info({ tableId, tournamentMatchId: table.tournamentMatchId, isHvb: table.isHvb, round: ps.round, scores: ps.scores }, 'rematch starting new game')

  const updated = await db.table.update({
    where: { id: tableId },
    data:  { status: 'ACTIVE', previewState: ps },
  })

  const startPayload = {
    board:       ps.board,
    currentTurn: ps.currentTurn,
    round:       ps.round,
    scores:      ps.scores,
  }
  if (io) io.to(`table:${tableId}`).emit('game:start', startPayload)
  appendToStream(`table:${tableId}:state`, { kind: 'start', ...startPayload }, { userId: '*' }).catch(() => {})

  if (table.isHvb && ps.currentTurn === ps.botMark) {
    const { dispatchBotMove } = await getSocketHandlerHelpers()
    dispatchBotMove(updated, io).catch((err) => logger.warn({ err }, 'Failed to dispatch bot opening move on rematch'))
  }

  return { ok: true, table: updated, previewState: ps }
}

/**
 * Create a PvP table with the calling user seated as the host. Returns
 * everything the caller needs to send the personal `room:created`
 * one-shot (slug, label, mark) and to register the socket/session.
 *
 * `seatId` is what goes into the seat — betterAuthId for signed-in users,
 * a transport-derived sentinel for guests (`guest:<socket.id>` legacy /
 * `guest:<sseSessionId>` for the new transport). Caller supplies it.
 */
export async function createPvpTable({ user, seatId, spectatorAllowed = true, gameflowVia = null }) {
  if (!seatId) return { ok: false, code: 'BAD_REQUEST' }

  const slug = nanoid(8)
  const marks = { [seatId]: 'X' }

  // Guest tables are always private — they're ephemeral throwaway games
  // that shouldn't clutter the public Tables list. Table GC auto-cleans
  // them after completion (COMPLETED + >24h).
  const isGuest = !user?.betterAuthId
  const table = await createTableTracked({
    data: {
      gameId:       'xo',
      slug,
      createdById:  user?.betterAuthId ?? 'anonymous',
      minPlayers:   2,
      maxPlayers:   2,
      isPrivate:    isGuest || !spectatorAllowed,
      status:       'FORMING',
      seats: [
        { userId: seatId, status: 'occupied', displayName: user?.displayName ?? 'Guest' },
        { userId: null,   status: 'empty' },
      ],
      previewState: makePreviewState({ marks }),
      ...(gameflowVia ? { gameflowVia } : {}),
    },
  })

  return {
    ok:    true,
    table,
    slug:  table.slug,
    label: formatTableLabel(table, seatId),
    mark:  'X',
  }
}

/**
 * Create (or reuse) a human-vs-bot table.
 *
 * Three paths, in priority order:
 *   1. **Tournament rejoin** — host has an ACTIVE table for the same
 *      `tournamentMatchId`: return its current state. (No DB write.)
 *   2. **Tournament rematch-in-place** — host has a COMPLETED non-finished
 *      tournament table: flip back to ACTIVE with a fresh board, scores
 *      preserved, round incremented, marks alternated.
 *   3. **Brand new table** — DB create with the bot seated as opponent.
 *
 * Returns `{ ok, action, ...details }` where `action` is `'rejoined' |
 * 'rematched' | 'created'` so the caller can log/branch.
 */
export async function createHvbTable({
  user,
  seatId,
  gameId            = 'xo',
  botUserId,
  spectatorAllowed  = true,
  tournamentMatchId = null,
}) {
  // Phase 3.8.5.2 — picker payload carries only botId. The skill is
  // resolved server-side from (botId, gameId) below; any client-supplied
  // botSkillId is intentionally not part of this signature.
  if (!seatId)     return { ok: false, code: 'BAD_REQUEST',  message: 'seatId required' }
  if (!botUserId)  return { ok: false, code: 'BAD_REQUEST',  message: 'botUserId required' }

  // ── Path 1 / 2: Tournament HvB series reuse ────────────────────────────
  // Without this, every "Play Match" click creates a fresh Table with
  // scores={X:0,O:0}, so a player who navigates away mid-series loses all
  // accumulated wins and the series never reaches the required win count.
  if (tournamentMatchId && user?.betterAuthId) {
    const existing = await db.table.findFirst({
      where:   { tournamentMatchId },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) {
      const eps = existing.previewState || {}
      const hostSeatId = existing.seats?.[0]?.userId
      if (hostSeatId === user.betterAuthId) {
        const xWins = eps.scores?.X ?? 0
        const oWins = eps.scores?.O ?? 0
        const required = Math.ceil((existing.bestOfN ?? 1) / 2)
        const seriesDone = xWins >= required || oWins >= required

        if (existing.status === 'ACTIVE') {
          logger.info({ tableId: existing.id, tournamentMatchId }, 'hvb tournament table rejoined (active)')
          return {
            ok:          true,
            action:      'rejoined',
            table:       existing,
            slug:        existing.slug,
            label:       formatTableLabel(existing, user.betterAuthId),
            mark:        eps.marks?.[user.betterAuthId] ?? 'X',
            board:       eps.board,
            currentTurn: eps.currentTurn,
          }
        }

        if (existing.status === 'COMPLETED' && !seriesDone) {
          // Rematch-in-place: preserve scores, increment round, new board.
          const fps = { ...eps }
          fps.board = Array(9).fill(null)
          fps.currentTurn = fps.currentTurn === 'X' ? 'O' : 'X'
          fps.winner = null
          fps.winLine = null
          fps.moves = []
          fps.round = (fps.round || 1) + 1

          const refreshed = await db.table.update({
            where: { id: existing.id },
            data:  { status: 'ACTIVE', previewState: fps },
          })

          logger.info({ tableId: refreshed.id, tournamentMatchId, round: fps.round, scores: fps.scores }, 'hvb tournament table reused (rematch-in-place)')

          // Bot opening if alternation put the bot on move.
          if (refreshed.isHvb && fps.currentTurn === fps.botMark) {
            const { dispatchBotMove } = await getSocketHandlerHelpers()
            // io is supplied by the caller in the response — but we don't have
            // it here. The service interface keeps io out of the rematch path
            // for now: caller (socketHandler) will pass `dispatchBotMoveAfter`.
            // For correctness right now, dispatch it from caller via the
            // returned `botOpeningPending` flag.
            void dispatchBotMove  // referenced lazily; caller dispatches.
          }

          return {
            ok:                true,
            action:            'rematched',
            table:             refreshed,
            slug:              refreshed.slug,
            label:             formatTableLabel(refreshed, user.betterAuthId),
            mark:              fps.marks?.[user.betterAuthId] ?? 'X',
            board:             fps.board,
            currentTurn:       fps.currentTurn,
            botOpeningPending: refreshed.isHvb && fps.currentTurn === fps.botMark,
          }
        }

        logger.warn({ tableId: existing.id, tournamentMatchId }, 'tournament series already complete — creating new table')
      }
    }
  }

  // ── Path 3: Brand new table ────────────────────────────────────────────

  // `botUserId` from the client is betterAuthId for real community bots,
  // but seeded tournament bots have no betterAuthId — callers pass the
  // plain User.id instead. Accept either and resolve to a canonical seat
  // identifier (`betterAuthId ?? User.id`) the rest of the code can rely on.
  let botUserRow = await db.user.findFirst({
    where:  { betterAuthId: botUserId },
    select: { id: true, betterAuthId: true },
  })
  if (!botUserRow) {
    botUserRow = await db.user.findUnique({
      where:  { id: botUserId },
      select: { id: true, betterAuthId: true },
    })
  }
  if (!botUserRow) return { ok: false, code: 'BOT_NOT_FOUND', message: 'Bot not found' }

  const botSeatId = botUserRow.betterAuthId ?? botUserRow.id
  const marks = { [seatId]: 'X', [botSeatId]: 'O' }

  // Resolve the game-specific skill server-side so the wrong-game skill
  // can never be used (e.g. an XO skill running in a Connect4 game).
  // Phase 3.8.5.2 — the server is fully authoritative here. If the bot
  // has no skill for this game, the match cannot start; the picker is
  // already filtered by `?gameId=` so this is a defensive 400 for the
  // edge cases the picker can't catch (race with skill deletion, bots
  // listed without per-game filtering, etc.).
  const skill = await resolveSkillForGame(botUserRow.id, gameId)
  if (!skill) {
    return {
      ok:      false,
      code:    'NO_SKILL',
      message: `Bot has no skill for game "${gameId}"`,
    }
  }
  const resolvedSkillId = skill.id

  // For tournament MIXED matches: resolve tournamentId + bestOfN so the
  // series play and result recording work like a first-class tournament
  // game. Unauthenticated or spectator callers shouldn't create tournament
  // HvB tables — silently drop the hint.
  let tourIdForTable        = null
  let tourMatchIdForTable   = null
  let tourBestOfN           = null
  let tourMatchOpponentName = null
  if (tournamentMatchId && user?.betterAuthId) {
    try {
      const tm = await db.tournamentMatch.findUnique({
        where:  { id: tournamentMatchId },
        select: { tournamentId: true, participant1Id: true, participant2Id: true },
      })
      const tour = tm?.tournamentId
        ? await db.tournament.findUnique({
            where:  { id: tm.tournamentId },
            select: { bestOfN: true, mode: true },
          })
        : null
      if (tm && tour && tour.mode === 'MIXED') {
        tourIdForTable      = tm.tournamentId
        tourMatchIdForTable = tournamentMatchId
        tourBestOfN         = tour.bestOfN ?? null
        logger.info({ tournamentMatchId, tourBestOfN, mode: tour.mode }, 'hvb table linked to tournament match')
      } else {
        logger.warn({ tournamentMatchId, mode: tour?.mode, hasTM: !!tm }, 'hvb tournament link skipped — mode not MIXED or match not found')
        if (tm) {
          // Look up the opponent participant's display name for the seat.
          const me = await db.user.findUnique({
            where:  { betterAuthId: user.betterAuthId },
            select: { id: true },
          })
          if (me?.id) {
            const participantIds = [tm.participant1Id, tm.participant2Id].filter(Boolean)
            const participants = await db.tournamentParticipant.findMany({
              where:  { id: { in: participantIds } },
              select: { userId: true, user: { select: { displayName: true } } },
            })
            const opponent = participants.find(p => p.userId !== me.id)
            tourMatchOpponentName = opponent?.user?.displayName ?? null
          }
        }
      }
    } catch (err) {
      logger.warn({ err, tournamentMatchId }, 'failed to resolve tournament match for hvb table')
    }
  }

  const isGuest = !user?.betterAuthId
  // Bot's seat-display name preference: tournament-resolved opponent name
  // (for MIXED matches), else the bot's own user.displayName, else 'Bot'.
  const botSeatDisplayName = tourMatchOpponentName
    ?? (await db.user.findUnique({ where: { id: botUserRow.id }, select: { displayName: true } }).catch(() => null))?.displayName
    ?? 'Bot'

  const slug = nanoid(8)
  const table = await createTableTracked({
    data: {
      gameId,
      slug,
      createdById:       user?.betterAuthId ?? 'anonymous',
      minPlayers:        2,
      maxPlayers:        2,
      isPrivate:         isGuest || !spectatorAllowed,
      status:            'ACTIVE',
      isHvb:             true,
      botUserId:         botSeatId,
      botSkillId:        resolvedSkillId,
      tournamentId:      tourIdForTable,
      tournamentMatchId: tourMatchIdForTable,
      isTournament:      !!tourMatchIdForTable,
      bestOfN:           tourBestOfN,
      seats: [
        { userId: seatId,    status: 'occupied', displayName: user?.displayName ?? 'Guest' },
        { userId: botSeatId, status: 'occupied', displayName: botSeatDisplayName },
      ],
      previewState: makePreviewState({ marks, botMark: 'O' }),
    },
  })

  const ps = table.previewState
  return {
    ok:          true,
    action:      'created',
    table,
    slug:        table.slug,
    label:       formatTableLabel(table, seatId),
    mark:        'X',
    board:       ps.board,
    currentTurn: ps.currentTurn,
  }
}

/** Internal — ELO + display name lookup for `sanitizeTable` extras.
 *
 *  Hydrates seat displayName from the User table when the seat itself doesn't
 *  carry one. Older REST seat-creation paths (`POST /api/v1/tables/:id/join`
 *  before 2026-04-29) wrote `{ userId, status }` without a displayName field
 *  — those rows still exist in dev/staging DBs, and without this fallback
 *  the rt host_reattach path returns `hostUserDisplayName: null` and the
 *  client renders the literal "Host"/"Guest" string in the seat-pod label.
 */
async function buildExtras(hostSeat, guestSeat, guestUserDomainId) {
  // Per-seat resolver. Seats can hold either a betterAuthId (human PvP) or a
  // domain User.id (bots — bots have no BetterAuth row). Try both shapes so
  // the spar/demo bot-vs-bot spectator path resolves bot ownership without
  // breaking the pre-existing human PvP lookup.
  async function lookupSeat(seat, fallbackDomainId) {
    let displayName = seat?.displayName ?? null
    const seatId = seat?.userId ?? null
    let userRow = null
    if (seatId) {
      // Seat IDs hold either a BetterAuth id (humans at PvP tables) or a
      // domain User.id (bots — bots have no BetterAuth row). Try both.
      userRow = await db.user.findUnique({
        where:  { betterAuthId: seatId },
        select: { id: true, displayName: true, isBot: true, botOwnerId: true },
      })
      if (!userRow) {
        userRow = await db.user.findUnique({
          where:  { id: seatId },
          select: { id: true, displayName: true, isBot: true, botOwnerId: true },
        })
      }
    } else if (fallbackDomainId) {
      userRow = await db.user.findUnique({
        where:  { id: fallbackDomainId },
        select: { id: true, displayName: true, isBot: true, botOwnerId: true },
      })
    }
    if (!userRow) return { displayName, elo: null, isBot: false, ownerBaId: null }
    if (!displayName) displayName = userRow.displayName ?? null
    const eloRow = await db.gameElo.findUnique({ where: { userId_gameId: { userId: userRow.id, gameId: 'xo' } } })
    let ownerBaId = null
    if (userRow.isBot && userRow.botOwnerId) {
      const owner = await db.user.findUnique({
        where:  { id: userRow.botOwnerId },
        select: { betterAuthId: true },
      })
      ownerBaId = owner?.betterAuthId ?? null
    }
    return { displayName, elo: eloRow?.rating ?? null, isBot: !!userRow.isBot, ownerBaId }
  }

  const host  = await lookupSeat(hostSeat,  null)
  const guest = await lookupSeat(guestSeat, guestUserDomainId)
  return {
    hostUserDisplayName:  host.displayName,
    hostUserElo:          host.elo,
    hostUserIsBot:        host.isBot,
    hostUserOwnerBaId:    host.ownerBaId,
    guestUserDisplayName: guest.displayName,
    guestUserElo:         guest.elo,
    guestUserIsBot:       guest.isBot,
    guestUserOwnerBaId:   guest.ownerBaId,
  }
}

/**
 * Join an existing table as player or spectator. Pure DB + broadcast logic;
 * the caller (legacy socket handler or rt POST route) handles transport
 * bookkeeping (`socket.join`, `_spectatorSockets`, idle timers).
 *
 * Returns `{ ok, code?, message?, action, ...details }` where action is one of:
 *   - `'spectated_pvp'`           — joined an open PvP table as spectator
 *   - `'reattached_active'`       — player re-attaching to ACTIVE table mid-game
 *   - `'host_reattach'`           — host re-attaching to own seat in FORMING table
 *   - `'creator_seated'`          — creator seating themselves at seat 0 of FORMING
 *   - `'guest_seated'`            — guest seating themselves at seat 1 of FORMING
 *
 * The two bot-game spectator paths (demo + regular bot game by slug) are
 * NOT handled here — they live in botGameRunner and the legacy socket
 * handler keeps that branch.
 */
export async function joinTable({ io, user, seatId, slug, role = 'player' }) {
  if (!slug)   return { ok: false, code: 'BAD_REQUEST', message: 'slug required' }
  if (!seatId) return { ok: false, code: 'BAD_REQUEST', message: 'seatId required' }

  const table = await db.table.findFirst({ where: { slug } })
  if (!table) return { ok: false, code: 'TABLE_NOT_FOUND', message: 'Room not found' }

  const seats = table.seats || []

  // ── Spectator path ──────────────────────────────────────────────────────
  if (role === 'spectator') {
    // The Hook step 2 demo creates a private bot-vs-bot table with the human
    // user as the spectator; their `seatId` (betterAuthId) matches
    // `createdById`. Without this exception the demo flow 403s on its own
    // table the moment GameView's join POST fires.
    if (table.isPrivate && table.createdById !== seatId) {
      return { ok: false, code: 'PRIVATE_TABLE', message: 'Spectators not allowed in this room' }
    }
    // Without a room payload the client falls back to the literal "Host"/
    // "Guest" strings at useGameSDK applyJoinResult — the demo bot names
    // (Rusty/Copper/...) never reach the seat-pod labels. Build it from the
    // seats already hydrated by withSeatDisplay (or seeded directly for demo
    // tables, which don't have BetterAuth identities to look up).
    const extras = await buildExtras(seats[0], seats[1], null)
    const { sanitizeTable } = await getSocketHandlerHelpers()
    const ps = table.previewState || {}
    return {
      ok:     true,
      action: 'spectated_pvp',
      table,
      room:   sanitizeTable(table, extras),
      ...(ps.board ? {
        startPayload: {
          board:       ps.board,
          currentTurn: ps.currentTurn ?? 'X',
          round:       ps.round ?? 1,
        },
      } : {}),
    }
  }

  // ── Player path ─────────────────────────────────────────────────────────

  // ACTIVE table re-attach (Tables flow): caller is expected to already
  // be seated. The HTTP /join already filled the seats and flipped ACTIVE.
  if (table.status === 'ACTIVE') {
    const mySeat = seats.findIndex(s => s?.userId === seatId && s?.status === 'occupied')
    if (mySeat === -1) return { ok: false, code: 'ROOM_FULL', message: 'Room is full' }

    const ps = table.previewState || {}
    const mark = ps.marks?.[seatId] ?? (mySeat === 0 ? 'X' : 'O')
    const extras = await buildExtras(seats[0], seats[1], user?.id ?? null)
    const { sanitizeTable } = await getSocketHandlerHelpers()

    return {
      ok:     true,
      action: 'reattached_active',
      table,
      mark,
      room:   sanitizeTable(table, extras),
      startPayload: {
        board:       ps.board,
        currentTurn: ps.currentTurn,
        round:       ps.round ?? 1,
      },
    }
  }

  if (table.status !== 'FORMING') return { ok: false, code: 'TABLE_NOT_FOUND', message: 'Room not found' }
  if (seats[1]?.status === 'occupied') return { ok: false, code: 'ROOM_FULL', message: 'Room is full' }

  // Tournament room host reconnect — caller is already in seat 0.
  if (seats[0]?.userId === seatId && seats[0]?.status === 'occupied') {
    const mark = table.previewState?.marks?.[seatId] ?? 'X'
    const extras = await buildExtras(seats[0], seats[1], user?.id ?? null)
    const { sanitizeTable } = await getSocketHandlerHelpers()
    return {
      ok:     true,
      action: 'host_reattach',
      table,
      mark,
      room:   sanitizeTable(table, extras),
    }
  }

  // Tournament rooms require an authenticated player in the second seat.
  if (table.isTournament && !user?.betterAuthId) {
    return { ok: false, code: 'AUTH_REQUIRED', message: 'Authentication required for this match' }
  }

  // Creator seating themselves at seat 0.
  if (seats[0]?.status !== 'occupied' && seatId === table.createdById) {
    const priorPs = table.previewState || {}
    const marks = { ...(priorPs.marks || {}), [seatId]: 'X' }
    const newSeats = [
      { userId: seatId, status: 'occupied', displayName: user?.displayName ?? 'Host' },
      seats[1] || { userId: null, status: 'empty' },
    ]
    const bothSeated = newSeats.every(s => s?.status === 'occupied')
    const ps = bothSeated
      ? { ...makePreviewState({ marks }), scores: priorPs.scores ?? { X: 0, O: 0 } }
      : { ...priorPs, marks }
    const updated = await db.table.update({
      where: { id: table.id },
      data:  {
        status:       bothSeated ? 'ACTIVE' : 'FORMING',
        seats:        newSeats,
        previewState: ps,
      },
    })
    const extras = await buildExtras(newSeats[0], newSeats[1], user?.id ?? null)
    const { sanitizeTable } = await getSocketHandlerHelpers()
    const room = sanitizeTable(updated, extras)

    if (bothSeated) {
      dualEmitLifecycle(io, updated.id, 'guestJoined', { room })
      const startPayload = { board: ps.board, currentTurn: ps.currentTurn, round: ps.round ?? 1 }
      if (io) io.to(`table:${updated.id}`).emit('game:start', startPayload)
      appendToStream(`table:${updated.id}:state`, { kind: 'start', ...startPayload }, { userId: '*' }).catch(() => {})
    }

    return {
      ok:     true,
      action: 'creator_seated',
      table:  updated,
      mark:   'X',
      room,
      bothSeated,
    }
  }

  // Guest seating themselves at seat 1.
  const priorPs = table.previewState || {}
  const marks = { ...(priorPs.marks || {}) }
  if (seats[0]?.userId) marks[seats[0].userId] = marks[seats[0].userId] || 'X'
  marks[seatId] = 'O'

  const newSeats = [
    seats[0] || { userId: null, status: 'empty' },
    { userId: seatId, status: 'occupied', displayName: user?.displayName ?? 'Guest' },
  ]
  const bothSeated = newSeats.every(s => s?.status === 'occupied')
  const ps = bothSeated
    ? { ...makePreviewState({ marks }), scores: priorPs.scores ?? { X: 0, O: 0 } }
    : { ...priorPs, marks }

  const updated = await db.table.update({
    where: { id: table.id },
    data:  {
      status:       bothSeated ? 'ACTIVE' : 'FORMING',
      seats:        newSeats,
      previewState: ps,
    },
  })

  const extras = await buildExtras(newSeats[0], newSeats[1], user?.id ?? null)
  const { sanitizeTable } = await getSocketHandlerHelpers()
  const room = sanitizeTable(updated, extras)

  dualEmitLifecycle(io, updated.id, 'guestJoined', { room })
  if (bothSeated) {
    const startPayload = { board: ps.board, currentTurn: ps.currentTurn, round: ps.round ?? 1 }
    if (io) io.to(`table:${updated.id}`).emit('game:start', startPayload)
    appendToStream(`table:${updated.id}:state`, { kind: 'start', ...startPayload }, { userId: '*' }).catch(() => {})
  }

  return {
    ok:     true,
    action: 'guest_seated',
    table:  updated,
    mark:   'O',
    room,
    bothSeated,
  }
}
