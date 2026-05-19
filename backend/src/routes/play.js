// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * /api/v1/play — single-round-trip start endpoints for the "play vs bot"
 * landing flow.
 *
 * `POST /play/bot` collapses what used to be 3 sequential RTTs into one:
 *   1. GET /api/v1/bots?gameId=…  (community bot resolution)
 *   2. open SSE EventSource        (session id allocation)
 *   3. POST /api/v1/rt/tables      (HvB table create, requires SSE session)
 *
 * On the warm-anon Hook journey landing path this shaves ~200 ms desktop /
 * ~450 ms slow-mobile off `tReady`. The structural win is the pre-allocation
 * of the SSE session id server-side — the client opens its EventSource in
 * parallel with rendering the opening board (which is in the response
 * already).
 *
 * Companion to Future_Ideas.md → PlayVsBot CTA item 3.
 *
 * The legacy multi-step path (POST /rt/tables for PvP, tournaments, demo
 * tables, MIXED tournament HvB rematches) stays intact — this endpoint is
 * additive and only used when the client's `action === 'vs-community-bot'`.
 */
import { Router } from 'express'
import { optionalAuth, requireAuth } from '../middleware/auth.js'
import { mintSessionId } from '../realtime/flyReplay.js'
import * as sseSessions from '../realtime/sseSessions.js'
import * as tableFlow from '../services/tableFlowService.js'
import { listBots } from '../services/userService.js'
import { startRankedMatch } from '../services/rankedMatchOrchestrator.js'
import { appendToStream } from '../lib/eventStream.js'
import db from '../lib/db.js'
import logger from '../logger.js'
import { GAME_IDS, resolveGameSlug } from '../constants/games.js'

const router = Router()
router.use(optionalAuth)

// Display-name ordering for built-in community bots — mirrors the client's
// `communityBotCache.js` so resolution is deterministic across the two
// callers. Anything not in this map sinks to the end.
const BUILTIN_ORDER = { Rusty: 0, Copper: 1, Sterling: 2, Magnus: 3 }

async function resolveCommunityBot(gameId) {
  const all = await listBots({ includeInactive: false })
  const playable = all.filter(
    b => Array.isArray(b.playableGameIds) && b.playableGameIds.includes(gameId),
  )
  const builtin = playable
    .filter(b => !b.botOwnerId)
    .sort((a, b) => (BUILTIN_ORDER[a.displayName] ?? 99) - (BUILTIN_ORDER[b.displayName] ?? 99))
  return builtin[0] ?? playable[0] ?? null
}

async function resolveCaller(req, fallbackSessionId) {
  if (req.auth?.userId) {
    const user = await db.user.findUnique({
      where:  { betterAuthId: req.auth.userId },
      select: { id: true, betterAuthId: true, displayName: true },
    })
    if (user) {
      return {
        user,
        seatId:   user.betterAuthId,
        domainId: user.id,
        isGuest:  false,
      }
    }
  }
  return {
    user:     null,
    seatId:   `guest:${fallbackSessionId}`,
    domainId: null,
    isGuest:  true,
  }
}

// POST /api/v1/play/bot
//
// Body: { gameId?: 'xo', botUserId?: string }
//
// gameId defaults to 'xo'. If botUserId is provided, the server uses it
// as-is (caller picked a specific bot). Otherwise the server resolves the
// first built-in community bot for the gameId — same ordering as
// landing/src/lib/communityBotCache.js so the two callers agree.
//
// Response (200):
//   {
//     sseSessionId,    // pre-allocated; client passes via ?sseSession=
//     tableId,
//     slug,
//     label,
//     mark,            // human's mark (X|O)
//     board,           // 9-cell array
//     currentTurn,     // 'X' | 'O'
//     bot: { id, displayName, botModelId, botModelType },
//   }
//
// Status codes:
//   400  bad gameId, no bots playable for gameId, or createHvbTable rejected
//   404  no bot found (community pool empty)
//   500  internal
router.post('/bot', async (req, res) => {
  try {
    const { gameId: rawGameId = GAME_IDS.TIC_TAC_TOE, botUserId: requestedBotUserId = null } = req.body ?? {}
    if (typeof rawGameId !== 'string' || !rawGameId) {
      return res.status(400).json({ error: 'gameId required', code: 'BAD_REQUEST' })
    }
    // Normalize legacy slugs (e.g. 'xo' → 'tic-tac-toe') for clients on cached bundles.
    const gameId = resolveGameSlug(rawGameId) ?? rawGameId

    // Step 1: resolve the bot (caller-supplied or community default).
    let botUserId = requestedBotUserId
    let botRow    = null
    if (!botUserId) {
      const bot = await resolveCommunityBot(gameId)
      if (!bot) {
        return res.status(404).json({ error: 'No community bot available', code: 'BOT_NOT_FOUND' })
      }
      botUserId = bot.id
      botRow    = bot
    }

    // Step 2: pre-allocate the SSE session id. Registered with `res: null`
    // so attachRes() can claim it when the client opens EventSource. The
    // `onDispose` callback is installed by the events handler at claim time
    // (it needs req.app to look up io). joinTable() below writes through
    // because the entry exists.
    const sseSessionId = mintSessionId()
    sseSessions.register(sseSessionId, { userId: req.auth?.userId ?? null, res: null })

    // Step 3: resolve caller. Guests get a seatId tied to the new sessionId
    // so the table's ownership is stable across the SSE-open.
    const caller = await resolveCaller(req, sseSessionId)

    // Step 4: create the HvB table.
    const result = await tableFlow.createHvbTable({
      user:             caller.user,
      seatId:           caller.seatId,
      gameId,
      botUserId,
      spectatorAllowed: true,
    })
    if (!result.ok) {
      // Roll back the session — nothing else has happened with it yet.
      sseSessions.dispose(sseSessionId, { immediate: true })
      const status = result.code === 'BOT_NOT_FOUND' ? 404 : 400
      return res.status(status).json({ error: result.message ?? 'Bad request', code: result.code })
    }

    // Step 5: track the table on the session so disconnect-forfeit picks it
    // up when SSE eventually closes.
    sseSessions.joinTable(sseSessionId, result.table.id)

    // If we resolved a community bot by name, we already have its row.
    // Otherwise look up just enough to surface the display name in the
    // response so the client can title the board without a follow-up GET.
    let botSummary = botRow
      ? {
          id:            botRow.id,
          displayName:   botRow.displayName,
          botModelId:    botRow.botModelId ?? null,
          botModelType:  botRow.botModelType ?? null,
        }
      : null
    if (!botSummary) {
      const bRow = await db.user.findUnique({
        where:  { id: result.table.botUserId ?? botUserId },
        select: { id: true, displayName: true, botModelId: true, botModelType: true },
      }).catch(() => null)
      botSummary = bRow ?? { id: botUserId, displayName: null, botModelId: null, botModelType: null }
    }

    return res.json({
      sseSessionId,
      tableId:     result.table?.id ?? null,
      slug:        result.slug,
      label:       result.label,
      mark:        result.mark,
      board:       result.board,
      currentTurn: result.currentTurn,
      bot:         botSummary,
    })
  } catch (err) {
    logger.error({ err }, 'POST /play/bot failed')
    return res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/v1/play/ranked-bot
//
// Auth-required (unlike /play/bot which serves guests too). Mints a ranked
// best-of-2 Match against a community bot and returns the spawn metadata
// for game 1. The client renders the board with the first-mover's color
// already showing; no client-side color choice exists. When game 1 ends,
// `POST /api/v1/games` advances the match and the same table is reused
// for game 2 with swapped colors.
//
// Body: { gameId?: 'tic-tac-toe', botUserId?: string }
//
// Response (200):
//   {
//     sseSessionId,
//     match: { id, format, sequence: 1, p1IsFirstMover, humanIsFirstMover },
//     tableId, slug, label,
//     mark,            // 'X' or 'O' — the human's mark this game
//     board, currentTurn,
//     bot: { id, displayName, botModelId, botModelType },
//   }
router.post('/ranked-bot', requireAuth, async (req, res) => {
  try {
    const { gameId: rawGameId = GAME_IDS.TIC_TAC_TOE, botUserId: requestedBotUserId = null } = req.body ?? {}
    if (typeof rawGameId !== 'string' || !rawGameId) {
      return res.status(400).json({ error: 'gameId required', code: 'BAD_REQUEST' })
    }
    const gameId = resolveGameSlug(rawGameId) ?? rawGameId

    // Auth lookup — required for ranked play (need a real Match.player1Id).
    const player1 = await db.user.findUnique({
      where:  { betterAuthId: req.auth.userId },
      select: { id: true, betterAuthId: true, displayName: true },
    })
    if (!player1) return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' })

    // Resolve the bot (caller-supplied or community default).
    let botUserId = requestedBotUserId
    let botRow    = null
    if (!botUserId) {
      const bot = await resolveCommunityBot(gameId)
      if (!bot) {
        return res.status(404).json({ error: 'No community bot available', code: 'BOT_NOT_FOUND' })
      }
      botUserId = bot.id
      botRow    = bot
    }
    // botUserId from the picker may be a betterAuthId (community bots) or
    // a domain User.id (seeded bots). Resolve to the User row so Match
    // foreign keys land on the canonical id.
    let botUserRow = await db.user.findFirst({
      where:  { betterAuthId: botUserId },
      select: { id: true, betterAuthId: true, displayName: true, botModelId: true, botModelType: true },
    })
    if (!botUserRow) {
      botUserRow = await db.user.findUnique({
        where:  { id: botUserId },
        select: { id: true, betterAuthId: true, displayName: true, botModelId: true, botModelType: true },
      })
    }
    if (!botUserRow) return res.status(404).json({ error: 'Bot not found', code: 'BOT_NOT_FOUND' })

    // Mint the Match row first — orchestrator decides game-1 first-mover
    // from the deterministic seed.
    const { match, spawn } = await startRankedMatch({
      gameId,
      player1Id: player1.id,
      player2Id: botUserRow.id,
    })

    // Pre-allocate the SSE session id (same pattern as /play/bot — the
    // client opens its EventSource in parallel with rendering the board).
    const sseSessionId = mintSessionId()
    sseSessions.register(sseSessionId, { userId: req.auth.userId, res: null })

    // Mint the HvB table with the ranked-match context. The human is the
    // first mover iff `spawn.firstMoverId === player1.id` — the
    // orchestrator returns IDs, not seat tokens.
    const humanIsFirstMover = spawn.firstMoverId === player1.id
    const result = await tableFlow.createHvbTable({
      user:             player1,
      seatId:           player1.betterAuthId,
      gameId,
      botUserId:        botUserRow.betterAuthId ?? botUserRow.id,
      spectatorAllowed: true,
      rankedMatch:      { id: match.id, humanIsFirstMover },
    })
    if (!result.ok) {
      // Roll back the SSE session — table-mint is the only side effect
      // beyond the Match row, and the Match row is cheap enough to leak
      // (it lifecycles itself out via the CANCELLED state if needed).
      sseSessions.dispose(sseSessionId, { immediate: true })
      const status = result.code === 'BOT_NOT_FOUND' ? 404 : 400
      return res.status(status).json({ error: result.message ?? 'Bad request', code: result.code })
    }

    sseSessions.joinTable(sseSessionId, result.table.id)

    // When the bot drew X for game 1, it has to make the opening move —
    // without this the client renders an empty board with currentTurn=X
    // and waits for a play that's the bot's responsibility. Mirrors the
    // dispatch in rematchRankedTableInPlace for games 2+.
    if (!humanIsFirstMover) {
      const handler = await import('../realtime/socketHandler.js')
      handler.dispatchBotMove?.(result.table, null).catch((err) =>
        logger.warn({ err, tableId: result.table?.id }, 'Failed to dispatch bot opening move on ranked game 1')
      )
    }

    // A2.7 — broadcast `match.started` on the table's state channel so any
    // subscriber (player + spectators in a future surface) can render the
    // "Best of 2 · Game 1" indicator without a separate fetch.
    appendToStream(
      `table:${result.table.id}:state`,
      {
        kind:           'match.started',
        matchId:        match.id,
        format:         match.format,
        sequence:       spawn.sequence,
        firstMoverId:   spawn.firstMoverId,
        p1IsFirstMover: spawn.p1IsFirstMover,
        gameId,
      },
      { userId: '*' },
    ).catch(() => {})

    const botSummary = botRow
      ? {
          id:           botRow.id,
          displayName:  botRow.displayName,
          botModelId:   botRow.botModelId ?? null,
          botModelType: botRow.botModelType ?? null,
        }
      : {
          id:           botUserRow.id,
          displayName:  botUserRow.displayName,
          botModelId:   botUserRow.botModelId ?? null,
          botModelType: botUserRow.botModelType ?? null,
        }

    return res.json({
      sseSessionId,
      match: {
        id:               match.id,
        format:           match.format,
        sequence:         spawn.sequence,
        p1IsFirstMover:   spawn.p1IsFirstMover,
        humanIsFirstMover,
      },
      tableId:     result.table?.id ?? null,
      slug:        result.slug,
      label:       result.label,
      mark:        result.mark,
      board:       result.board,
      currentTurn: result.currentTurn,
      bot:         botSummary,
    })
  } catch (err) {
    logger.error({ err }, 'POST /play/ranked-bot failed')
    return res.status(500).json({ error: 'Internal error' })
  }
})

export default router
