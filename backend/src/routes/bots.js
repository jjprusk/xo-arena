// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import db from '../lib/db.js'
import { createBot, listBots } from '../services/userService.js'
import { getSystemConfig } from '../services/skillService.js'
import { getTierLimit } from '../services/creditService.js'
import { hasRole } from '../utils/roles.js'
import { completeStep } from '../services/journeyService.js'
import cache from '../utils/cache.js'

const BOTS_CACHE_KEY = 'bots:public'
const BOTS_TTL_MS    = 60_000  // 60 seconds

const router = Router()

/**
 * GET /api/v1/bots
 * List bots. Optional ?ownerId= and ?includeInactive=true.
 * If ownerId is provided, also returns limitInfo.
 */
router.get('/', async (req, res, next) => {
  try {
    const { ownerId, includeInactive } = req.query

    // Owner-specific requests are user-scoped — never cache them.
    if (ownerId) {
      const bots = await listBots({ ownerId, includeInactive: includeInactive === 'true' })
      const owner = await db.user.findUnique({
        where: { id: ownerId },
        include: { userRoles: { select: { role: true } } },
      })
      const isExempt = owner ? hasRole(owner, 'BOT_ADMIN') : false
      const provisionalThreshold = await getSystemConfig('bots.provisionalGames', 5)
      const limit = isExempt ? null : (owner ? await getTierLimit(owner.id, 'bots') : 3)
      const count = await db.user.count({ where: { botOwnerId: ownerId, isBot: true } })
      return res.json({ bots, limitInfo: { count, limit, isExempt }, provisionalThreshold })
    }

    // Public active bot list — cacheable.
    const cached = cache.get(BOTS_CACHE_KEY)
    if (cached) {
      res.setHeader('X-Cache', 'HIT')
      return res.json({ bots: cached })
    }

    const bots = await listBots({ includeInactive: includeInactive === 'true' })
    cache.set(BOTS_CACHE_KEY, bots, BOTS_TTL_MS)

    res.setHeader('X-Cache', 'MISS')
    res.json({ bots })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/v1/bots/mine
 * Return the authenticated user's own bots. Used by registration UIs.
 */
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const baId = req.auth.userId
    const caller = await db.user.findUnique({ where: { betterAuthId: baId }, select: { id: true } })
    if (!caller) return res.status(401).json({ error: 'Unauthorized' })
    const bots = await listBots({ ownerId: caller.id })
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

    // Enforce bot limit (0 = unlimited for Diamond-tier users)
    if (!hasRole(user, 'BOT_ADMIN')) {
      const limit = await getTierLimit(userId, 'bots')
      const count = await db.user.count({ where: { botOwnerId: userId, isBot: true } })
      if (limit !== 0 && count >= limit) {
        return res.status(409).json({ error: `Bot limit reached (${limit})`, code: 'BOT_LIMIT_REACHED' })
      }
    }

    const { name, modelType, competitive, avatarUrl } = req.body
    const bot = await createBot(userId, { name, algorithm: 'ml', modelType, competitive, avatarUrl, ownerBaId: baId })
    cache.invalidate(BOTS_CACHE_KEY)

    // Journey step 3 (Curriculum: Create your first bot) — fire-and-forget.
    // Was step 5 in the legacy 7-step spec; renumbered in the v1 Intelligent
    // Guide rewrite (§4).
    completeStep(userId, 3).catch(() => {})

    res.status(201).json({ bot })
  } catch (err) {
    if (err.code === 'RESERVED_NAME') return res.status(400).json({ error: err.message, code: err.code })
    if (err.code === 'PROFANITY') return res.status(400).json({ error: err.message, code: err.code })
    if (err.code === 'INVALID_NAME') return res.status(400).json({ error: err.message, code: err.code })
    if (err.code === 'INVALID_ALGORITHM') return res.status(400).json({ error: err.message, code: err.code })
    // Phase 3.7a.2: two partial unique indexes on users enforce hybrid bot
    // displayName uniqueness (per-owner + reserved built-in names). Prisma
    // reports both via code P2002; meta.target carries the index name.
    if (err.code === 'P2002') {
      const target = err.meta?.target
      const asStr  = Array.isArray(target) ? target.join(',') : String(target ?? '')
      if (asStr.includes('displayname') || asStr.includes('displayName')) {
        return res.status(409).json({
          error:  'A bot with that name already exists — pick a different name.',
          code:   'BOT_NAME_TAKEN',
        })
      }
      // Other unique-constraint collisions (username, email, etc.) fall
      // through to the generic error handler below.
    }
    next(err)
  }
})

/**
 * POST /api/v1/bots/quick
 *
 * Quick Bot wizard endpoint (Curriculum step 3, §5.3) — friction-reduced bot
 * creation. Body: `{ name, persona }`. Always uses algorithm=minimax with the
 * tier from SystemConfig `guide.quickBot.defaultTier` (default 'novice') so
 * the user's bot starts at Rusty-equivalent strength. The first training run
 * (step 4) bumps the tier — that visible transformation is the pedagogy.
 *
 * Returns the same `{ bot }` shape as POST / so the client can reuse existing
 * bot-detail rendering.
 */
router.post('/quick', requireAuth, async (req, res, next) => {
  try {
    const baId = req.auth.userId
    const user = await db.user.findUnique({
      where: { betterAuthId: baId },
      include: { userRoles: { select: { role: true } } },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })

    // Bot-limit check mirrors POST / so quick-creators don't bypass the cap.
    if (!hasRole(user, 'BOT_ADMIN')) {
      const limit = await getTierLimit(user.id, 'bots')
      const count = await db.user.count({ where: { botOwnerId: user.id, isBot: true } })
      if (limit !== 0 && count >= limit) {
        return res.status(409).json({ error: `Bot limit reached (${limit})`, code: 'BOT_LIMIT_REACHED' })
      }
    }

    const { name, persona } = req.body ?? {}
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required', code: 'INVALID_NAME' })
    }
    // Persona is purely display — current bot row has no persona column, so
    // we accept and ignore it. Once we surface persona in the UI it gets
    // stored in user.preferences.botPersona[<botId>] or similar; out of scope
    // for Sprint 3.
    if (persona !== undefined && typeof persona !== 'string') {
      return res.status(400).json({ error: 'persona must be a string', code: 'INVALID_PERSONA' })
    }

    const tier = await getSystemConfig('guide.quickBot.defaultTier', 'novice')
    const bot = await createBot(user.id, {
      name,
      algorithm:  'minimax',
      difficulty: tier,
      ownerBaId:  baId,
    })
    cache.invalidate(BOTS_CACHE_KEY)

    // Curriculum step 3 — fire-and-forget; same pattern as POST /.
    completeStep(user.id, 3).catch(() => {})

    res.status(201).json({ bot })
  } catch (err) {
    if (err.code === 'RESERVED_NAME')      return res.status(400).json({ error: err.message, code: err.code })
    if (err.code === 'PROFANITY')          return res.status(400).json({ error: err.message, code: err.code })
    if (err.code === 'INVALID_NAME')       return res.status(400).json({ error: err.message, code: err.code })
    if (err.code === 'NAME_TAKEN')         return res.status(409).json({ error: err.message, code: err.code })
    if (err.code === 'INVALID_ALGORITHM')  return res.status(400).json({ error: err.message, code: err.code })
    next(err)
  }
})

/**
 * POST /api/v1/bots/:id/train-quick
 *
 * Quick Bot training-flow trigger (§5.3) — bumps the bot's botModelId tier
 * from `guide.quickBot.defaultTier` (novice → Rusty-equivalent) to
 * `guide.quickBot.firstTrainingTier` (intermediate → Copper-equivalent). This
 * is the "first training run that visibly transforms the bot" — the
 * pedagogical payoff for starting weak. Fires journey step 4 alongside the
 * existing mlService trigger for real ML training.
 *
 * No-op (200) if the bot is already at or past the trained tier — keeps the
 * UI simple (button can stay, click is idempotent).
 */
router.post('/:id/train-quick', requireAuth, async (req, res, next) => {
  try {
    const result = await loadBotAndAuthorize(req, res)
    if (!result) return
    const { bot, caller } = result

    // Only minimax bots use the user:<id>:minimax:<diff> botModelId pattern;
    // ML bots' botModelId is a UUID FK into BotSkill — bumping tier is
    // meaningless there. Reject early so the wrong button doesn't break a
    // real ML bot's model assignment.
    if (bot.botModelType !== 'minimax') {
      return res.status(400).json({ error: 'Quick training only applies to Quick Bots (minimax)', code: 'NOT_QUICK_BOT' })
    }

    const trainedTier = await getSystemConfig('guide.quickBot.firstTrainingTier', 'intermediate')
    const expectedId  = `user:${caller.id}:minimax:${trainedTier}`

    if (bot.botModelId === expectedId) {
      // Idempotent — still fire step 4 in case it never landed before.
      completeStep(caller.id, 4).catch(() => {})
      return res.json({ bot, alreadyTrained: true })
    }

    const updated = await db.user.update({
      where: { id: bot.id },
      data:  { botModelId: expectedId },
    })
    cache.invalidate(BOTS_CACHE_KEY)
    completeStep(caller.id, 4).catch(() => {})

    res.json({ bot: updated, alreadyTrained: false })
  } catch (err) {
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
      // Uniqueness check (skip if name is unchanged)
      if (trimmed.toLowerCase() !== result.bot.displayName.toLowerCase()) {
        const conflict = await db.user.findFirst({
          where: { isBot: true, displayName: { equals: trimmed, mode: 'insensitive' } },
        })
        if (conflict) {
          return res.status(409).json({ error: `"${trimmed}" is already taken — choose a different name`, code: 'NAME_TAKEN' })
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
    cache.invalidate(BOTS_CACHE_KEY)
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
      db.gameElo.upsert({
        where: { userId_gameId: { userId: bot.id, gameId: 'xo' } },
        update: { rating: 1200, gamesPlayed: 0 },
        create: { userId: bot.id, gameId: 'xo', rating: 1200, gamesPlayed: 0 },
      }),
      db.user.update({
        where: { id: bot.id },
        data: { botEloResetAt: new Date(), botProvisional: true, botGamesPlayed: 0 },
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
    const { bot } = result

    // Delete everything atomically so no orphaned ML models are left behind.
    // Games where this bot was player1 have a required (non-nullable) FK — no
    // cascade is defined so we must delete them first. Games where it was
    // player2 or winner use nullable FKs and will be set to null automatically.
    await db.$transaction(async (tx) => {
      await tx.game.deleteMany({ where: { player1Id: bot.id } })
      await tx.user.delete({ where: { id: bot.id } })
      if (bot.botModelId) {
        await tx.botSkill.delete({ where: { id: bot.botModelId } })
      }
    })

    cache.invalidate(BOTS_CACHE_KEY)
    res.status(204).end()
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Bot not found' })
    next(err)
  }
})

export default router
