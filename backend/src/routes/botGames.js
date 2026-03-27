/**
 * Bot vs Bot game management routes.
 *
 * POST /api/v1/bot-games        Start a new server-side bot vs bot game (admin/bot-admin only)
 * GET  /api/v1/bot-games        List active bot games
 * GET  /api/v1/bot-games/:slug  Get state of a specific bot game
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { botGameRunner } from '../realtime/botGameRunner.js'
import { getUserByBetterAuthId } from '../services/userService.js'
import { hasRole } from '../utils/roles.js'
import db from '../lib/db.js'

const router = Router()

/**
 * POST /api/v1/bot-games
 * Start a bot vs bot game. Requires ADMIN or BOT_ADMIN role.
 * Body: { bot1Id, bot2Id, moveDelayMs? }
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const caller = await getUserByBetterAuthId(req.auth.userId)
    if (!caller) return res.status(404).json({ error: 'User not found' })
    if (!hasRole(caller, 'ADMIN') && !hasRole(caller, 'BOT_ADMIN')) {
      return res.status(403).json({ error: 'Requires ADMIN or BOT_ADMIN role' })
    }

    const { bot1Id, bot2Id, moveDelayMs } = req.body
    if (!bot1Id || !bot2Id) return res.status(400).json({ error: 'bot1Id and bot2Id are required' })
    if (bot1Id === bot2Id) return res.status(400).json({ error: 'Bots must be different' })

    const [bot1, bot2] = await Promise.all([
      db.user.findUnique({ where: { id: bot1Id }, select: { id: true, displayName: true, botModelId: true, isBot: true, botActive: true } }),
      db.user.findUnique({ where: { id: bot2Id }, select: { id: true, displayName: true, botModelId: true, isBot: true, botActive: true } }),
    ])

    if (!bot1?.isBot) return res.status(404).json({ error: 'bot1 not found or not a bot' })
    if (!bot2?.isBot) return res.status(404).json({ error: 'bot2 not found or not a bot' })
    if (!bot1.botActive) return res.status(409).json({ error: `${bot1.displayName} is inactive` })
    if (!bot2.botActive) return res.status(409).json({ error: `${bot2.displayName} is inactive` })

    const { slug, displayName } = await botGameRunner.startGame({
      bot1,
      bot2,
      moveDelayMs: moveDelayMs ? Number(moveDelayMs) : undefined,
    })

    res.status(201).json({ slug, displayName })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/v1/bot-games
 * List active bot vs bot games.
 */
router.get('/', (_req, res) => {
  res.json({ games: botGameRunner.listGames() })
})

/**
 * GET /api/v1/bot-games/:slug
 * Get state of a specific bot game (for initial spectator sync).
 */
router.get('/:slug', (req, res) => {
  const game = botGameRunner.getGame(req.params.slug)
  if (!game) return res.status(404).json({ error: 'Bot game not found' })

  res.json({
    game: {
      slug: game.slug,
      displayName: game.displayName,
      board: game.board,
      currentTurn: game.currentTurn,
      status: game.status,
      winner: game.winner,
      winLine: game.winLine,
      spectatorCount: game.spectatorIds.size,
      isBotGame: true,
      bot1: { displayName: game.bot1.displayName, mark: 'X' },
      bot2: { displayName: game.bot2.displayName, mark: 'O' },
    },
  })
})

export default router
