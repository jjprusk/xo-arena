import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import db from '../lib/db.js'
import { createBot, listBots } from '../services/userService.js'
import { getSystemConfig } from '../services/mlService.js'
import { hasRole } from '../utils/roles.js'

const router = Router()

/**
 * GET /api/v1/bots
 * List bots. Optional ?ownerId= and ?includeInactive=true.
 * If ownerId is provided, also returns limitInfo.
 */
router.get('/', async (req, res, next) => {
  try {
    const { ownerId, includeInactive } = req.query
    const bots = await listBots({
      ownerId: ownerId || undefined,
      includeInactive: includeInactive === 'true',
    })

    if (ownerId) {
      // Fetch the owner to determine limit info
      const owner = await db.user.findUnique({
        where: { id: ownerId },
        include: { userRoles: { select: { role: true } } },
      })
      const isExempt = owner ? hasRole(owner, 'BOT_ADMIN') : false
      const [defaultLimit, provisionalThreshold] = await Promise.all([
        getSystemConfig('bots.defaultBotLimit', 5),
        getSystemConfig('bots.provisionalGames', 5),
      ])
      const limit = isExempt ? null : (owner?.botLimit ?? defaultLimit)
      // Count all bots (including inactive) for limit purposes
      const count = await db.user.count({ where: { botOwnerId: ownerId, isBot: true } })
      return res.json({ bots, limitInfo: { count, limit, isExempt }, provisionalThreshold })
    }

    res.json({ bots })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/v1/bots
 * Create a new bot. Auth required. Enforces bot limit for non-admin/bot_admin users.
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const baId = req.auth.userId
    const user = await db.user.findUnique({
      where: { betterAuthId: baId },
      include: { userRoles: { select: { role: true } } },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })

    const userId = user.id

    // Enforce bot limit
    if (!hasRole(user, 'BOT_ADMIN')) {
      const defaultLimit = await getSystemConfig('bots.defaultBotLimit', 5)
      const limit = user.botLimit ?? defaultLimit
      const count = await db.user.count({ where: { botOwnerId: userId, isBot: true } })
      if (count >= limit) {
        return res.status(409).json({ error: `Bot limit reached (${limit})`, code: 'BOT_LIMIT_REACHED' })
      }
    }

    const { name, modelType, competitive, avatarUrl } = req.body
    const bot = await createBot(userId, { name, algorithm: 'ml', modelType, competitive, avatarUrl })
    res.status(201).json({ bot })
  } catch (err) {
    if (err.code === 'RESERVED_NAME') return res.status(400).json({ error: err.message, code: err.code })
    if (err.code === 'PROFANITY') return res.status(400).json({ error: err.message, code: err.code })
    if (err.code === 'INVALID_NAME') return res.status(400).json({ error: err.message, code: err.code })
    if (err.code === 'INVALID_ALGORITHM') return res.status(400).json({ error: err.message, code: err.code })
    next(err)
  }
})

/**
 * Helper: verify the caller owns the bot or has BOT_ADMIN/ADMIN role.
 * Returns { bot, caller } or sends an error response.
 */
async function loadBotAndAuthorize(req, res) {
  const baId = req.auth.userId
  const caller = await db.user.findUnique({
    where: { betterAuthId: baId },
    include: { userRoles: { select: { role: true } } },
  })
  if (!caller) { res.status(401).json({ error: 'Unauthorized' }); return null }

  const bot = await db.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, displayName: true, botOwnerId: true, botActive: true,
      botInTournament: true, botModelType: true, botModelId: true, isBot: true,
    },
  })
  if (!bot || !bot.isBot) { res.status(404).json({ error: 'Bot not found' }); return null }

  if (bot.botOwnerId !== caller.id && !hasRole(caller, 'BOT_ADMIN')) {
    res.status(403).json({ error: 'Forbidden' }); return null
  }

  return { bot, caller }
}

/**
 * PATCH /api/v1/bots/:id
 * Rename or toggle botActive.
 */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await loadBotAndAuthorize(req, res)
    if (!result) return

    const { displayName, botActive, botAvailable } = req.body
    const data = {}

    if (displayName !== undefined) {
      const trimmed = displayName.trim()
      if (!trimmed) return res.status(400).json({ error: 'Name cannot be empty' })

      // Reserved name check
      const RESERVED = ['rusty', 'copper', 'sterling', 'magnus']
      if (RESERVED.includes(trimmed.toLowerCase())) {
        return res.status(400).json({ error: `"${trimmed}" is a reserved name`, code: 'RESERVED_NAME' })
      }
      // Profanity check
      const profanityList = await getSystemConfig('bots.profanityList', [])
      if (Array.isArray(profanityList) && profanityList.length > 0) {
        const lower = trimmed.toLowerCase()
        for (const word of profanityList) {
          if (lower.includes(word.toLowerCase())) {
            return res.status(400).json({ error: 'Bot name contains disallowed content', code: 'PROFANITY' })
          }
        }
      }
      data.displayName = trimmed
    }

    if (botActive !== undefined) {
      data.botActive = Boolean(botActive)
    }

    if (botAvailable !== undefined) {
      data.botAvailable = Boolean(botAvailable)
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' })
    }

    const updated = await db.user.update({ where: { id: req.params.id }, data })
    res.json({ bot: updated })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/v1/bots/:id/reset-elo
 * Reset bot ELO to 1200, clear UserEloHistory, set botProvisional=true.
 * Blocked if botInTournament=true.
 */
router.post('/:id/reset-elo', requireAuth, async (req, res, next) => {
  try {
    const result = await loadBotAndAuthorize(req, res)
    if (!result) return
    const { bot } = result

    if (bot.botInTournament) {
      return res.status(409).json({ error: 'Cannot reset ELO while bot is in a tournament', code: 'BOT_IN_TOURNAMENT' })
    }

    // Clear UserEloHistory and reset ELO in a transaction
    await db.$transaction([
      db.userEloHistory.deleteMany({ where: { userId: bot.id } }),
      db.user.update({
        where: { id: bot.id },
        data: { eloRating: 1200, botEloResetAt: new Date(), botProvisional: true, botGamesPlayed: 0 },
      }),
    ])

    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/v1/bots/:id
 * Hard delete a bot.
 */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await loadBotAndAuthorize(req, res)
    if (!result) return

    await db.user.delete({ where: { id: req.params.id } })
    res.status(204).end()
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Bot not found' })
    next(err)
  }
})

export default router
