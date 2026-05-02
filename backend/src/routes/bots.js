// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import db from '../lib/db.js'
import { createBot, listBots } from '../services/userService.js'
import { getSystemConfig } from '../services/skillService.js'
import { getTierLimit } from '../services/creditService.js'
import { hasRole } from '../utils/roles.js'
import { completeStep } from '../services/journeyService.js'
import { deleteBot as deleteBotCascade, BuiltinBotProtectedError } from '../services/userDeletionService.js'
import * as mlSvc from '../services/mlService.js'
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
    const { ownerId, includeInactive, gameId } = req.query

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

    // Phase 3.8.2.6 — gameId filter for community bot pickers. Bypasses the
    // public cache because the filter dimension would multiply cache entries
    // for what is a relatively rare query path.
    if (gameId && typeof gameId === 'string') {
      const skillRows = await db.botSkill.findMany({
        where:    { gameId, botId: { not: null } },
        select:   { botId: true },
        distinct: ['botId'],
      })
      const botIds = skillRows.map((s) => s.botId).filter(Boolean)
      if (botIds.length === 0) return res.json({ bots: [] })

      const all = await listBots({ includeInactive: includeInactive === 'true' })
      const idSet = new Set(botIds)
      return res.json({ bots: all.filter((b) => idSet.has(b.id)) })
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
 * GET /api/v1/bots/:id
 *
 * Bot identity + per-game skills. Public — used by community bot pickers and
 * the Profile bot card. Each skill row carries the per-skill ELO joined from
 * `GameElo (userId=botId, gameId=skill.gameId)` so the client doesn't need a
 * second fetch.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const bot = await db.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, displayName: true, avatarUrl: true,
        isBot: true, botActive: true, botAvailable: true, botCompetitive: true,
        botProvisional: true, botGamesPlayed: true,
        botModelId: true, botModelType: true, botOwnerId: true,
        createdAt: true,
      },
    })
    if (!bot || !bot.isBot) return res.status(404).json({ error: 'Bot not found' })

    const skills = await db.botSkill.findMany({
      where: { botId: bot.id },
      orderBy: { createdAt: 'asc' },
    })

    const elos = skills.length === 0 ? [] : await db.gameElo.findMany({
      where: {
        userId: bot.id,
        gameId: { in: skills.map((s) => s.gameId) },
      },
      select: { gameId: true, rating: true, gamesPlayed: true },
    })
    const elosByGame = new Map(elos.map((e) => [e.gameId, e]))

    const enriched = skills.map((s) => ({
      ...s,
      elo: elosByGame.get(s.gameId) ?? null,
    }))

    res.json({ bot: { ...bot, skills: enriched } })
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
 * POST /api/v1/bots/:id/train-guided
 *
 * Journey step 4 — real Q-Learning training. Replaces the cosmetic tier bump
 * from `train-quick` with a genuine ~5s training run:
 *
 *   1. Creates (or reuses) a Q-Learning BotSkill bound to this bot.
 *   2. Calls mlService.startTraining — emits ml:progress / ml:complete on
 *      SSE channel `ml:session:<sessionId>:`. The browser subscribes and
 *      renders a live win-rate curve.
 *   3. Returns { sessionId, skillId, channelPrefix } so the client knows
 *      which session to listen for.
 *
 * Step 4 is NOT credited here — it fires from `/finalize` after the user has
 * actually seen training complete and we've swapped the bot's primary skill.
 * That avoids crediting drive-by clicks and keeps the celebration moment
 * tied to a real state change.
 *
 * Owner-only. Idempotent on rapid-fire clicks: if a session is already
 * running for the skill, returns the existing one instead of queuing a
 * second.
 */
router.post('/:id/train-guided', requireAuth, async (req, res, next) => {
  try {
    const result = await loadBotAndAuthorize(req, res)
    if (!result) return
    const { bot, caller } = result

    if (bot.botModelType !== 'minimax') {
      return res.status(400).json({ error: 'Guided training only applies to fresh Quick Bots', code: 'NOT_QUICK_BOT' })
    }

    let skill = await db.botSkill.findFirst({
      where:   { botId: bot.id, gameId: 'xo', algorithm: 'Q_LEARNING' },
      orderBy: { createdAt: 'desc' },
    })

    if (!skill) {
      const created = await mlSvc.createModel({
        name:        `${bot.displayName} XO`,
        algorithm:   'Q_LEARNING',
        config:      {},
        createdBy:   caller.betterAuthId ?? null,
      })
      skill = await db.botSkill.update({
        where: { id: created.id },
        data:  { botId: bot.id, gameId: 'xo' },
      })
    }

    const existingRunning = await db.trainingSession.findFirst({
      where:   { modelId: skill.id, status: { in: ['PENDING', 'RUNNING'] } },
      orderBy: { startedAt: 'desc' },
    })
    if (existingRunning) {
      return res.json({
        sessionId:     existingRunning.id,
        skillId:       skill.id,
        channelPrefix: `ml:session:${existingRunning.id}:`,
        reused:        true,
      })
    }

    // Empirically tuned for the journey-step-4 modal: VS_MINIMAX easy
    // produces a satisfying winRate climb from ~33% (random) to ~78% across
    // 30k episodes in ~5s. SELF_PLAY produces ~67% draws and a flat winRate
    // line — useless for a chart that's supposed to visibly *go up*.
    const iterations = await getSystemConfig('guide.training.iterations', 30000)
    const mode       = await getSystemConfig('guide.training.mode',       'VS_MINIMAX')
    const difficulty = await getSystemConfig('guide.training.difficulty', 'easy')
    const session = await mlSvc.startTraining(skill.id, {
      mode,
      iterations,
      config: { difficulty },
    })

    res.json({
      sessionId:     session.id,
      skillId:       skill.id,
      channelPrefix: `ml:session:${session.id}:`,
      reused:        false,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/v1/bots/:id/train-guided/finalize
 *
 * Body: { sessionId, skillId }
 *
 * Called by the client once the SSE `ml:complete` event arrives (i.e., the
 * user has actually watched their bot finish training). We:
 *
 *   1. Verify the session belongs to a skill bound to this bot and finished
 *      successfully.
 *   2. Swap `bot.botModelId` from the minimax tier label to the new skill
 *      UUID + flip `botModelType` to `qlearning` so the bot now plays as an
 *      ML bot in real games.
 *   3. Fire `completeStep(caller.id, 4)` to credit journey step 4.
 *
 * Idempotent — if the bot is already pointing at the skill, just re-fires
 * step 4 (in case the original credit didn't land) and returns 200.
 */
router.post('/:id/train-guided/finalize', requireAuth, async (req, res, next) => {
  try {
    const result = await loadBotAndAuthorize(req, res)
    if (!result) return
    const { bot, caller } = result

    const { sessionId, skillId } = req.body ?? {}
    if (!sessionId || !skillId) {
      return res.status(400).json({ error: 'sessionId and skillId are required', code: 'INVALID_BODY' })
    }

    const skill = await db.botSkill.findUnique({ where: { id: skillId } })
    if (!skill || skill.botId !== bot.id) {
      return res.status(404).json({ error: 'Skill not found for this bot', code: 'SKILL_NOT_FOUND' })
    }

    const session = await db.trainingSession.findUnique({ where: { id: sessionId } })
    if (!session || session.modelId !== skillId) {
      return res.status(404).json({ error: 'Session not found for this skill', code: 'SESSION_NOT_FOUND' })
    }
    if (session.status !== 'COMPLETED') {
      return res.status(409).json({ error: `Training is ${session.status.toLowerCase()}`, code: 'SESSION_NOT_COMPLETE' })
    }

    if (bot.botModelId !== skillId) {
      await db.user.update({
        where: { id: bot.id },
        data:  { botModelId: skillId, botModelType: 'qlearning' },
      })
      cache.invalidate(BOTS_CACHE_KEY)
    }

    completeStep(caller.id, 4).catch(() => {})

    const updated = await db.user.findUnique({
      where: { id: bot.id },
      select: {
        id: true, displayName: true,
        botModelId: true, botModelType: true,
      },
    })

    res.json({ bot: updated, summary: session.summary ?? null })
  } catch (err) {
    next(err)
  }
})

// Algorithms accepted by POST /:botId/skills. Mirrors the registry in
// backend/src/ai — kept as an explicit allow-list so a typo in the body
// can't create an unrunnable skill row.
const SUPPORTED_SKILL_ALGORITHMS = new Set([
  'minimax', 'ml', 'qlearning', 'sarsa', 'montecarlo', 'policygradient', 'dqn', 'alphazero',
])

/**
 * POST /api/v1/bots/:botId/skills
 *
 * Phase 3.8 multi-skill foundation. Body `{ gameId, algorithm, modelType? }`.
 * Idempotent on `(botId, gameId)` — a second call returns the existing skill
 * with status 200 instead of erroring. Sets `User.botModelId` to the new
 * skill if the bot had no primary skill before.
 */
/**
 * DELETE /api/v1/bots/:id/skills/:skillId
 *
 * Remove one skill from a bot. If the deleted skill was the bot's primary
 * (`User.botModelId`), repoint to any remaining skill or null.
 */
router.delete('/:id/skills/:skillId', requireAuth, async (req, res, next) => {
  try {
    const result = await loadBotAndAuthorize(req, res)
    if (!result) return
    const { bot } = result

    const skill = await db.botSkill.findUnique({ where: { id: req.params.skillId } })
    if (!skill || skill.botId !== bot.id) {
      return res.status(404).json({ error: 'Skill not found for this bot' })
    }

    await db.$transaction(async (tx) => {
      await tx.botSkill.delete({ where: { id: skill.id } })

      if (bot.botModelId === skill.id) {
        const remaining = await tx.botSkill.findFirst({
          where: { botId: bot.id },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
        await tx.user.update({
          where: { id: bot.id },
          data:  { botModelId: remaining ? remaining.id : null },
        })
      }
    })

    cache.invalidate(BOTS_CACHE_KEY)
    res.status(204).end()
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Skill not found' })
    next(err)
  }
})

router.post('/:id/skills', requireAuth, async (req, res, next) => {
  try {
    const result = await loadBotAndAuthorize(req, res)
    if (!result) return
    const { bot } = result

    const { gameId, algorithm, modelType } = req.body ?? {}
    if (typeof gameId !== 'string' || !gameId.trim()) {
      return res.status(400).json({ error: 'gameId is required', code: 'INVALID_GAME_ID' })
    }
    if (typeof algorithm !== 'string' || !SUPPORTED_SKILL_ALGORITHMS.has(algorithm)) {
      return res.status(400).json({ error: 'algorithm is required and must be supported', code: 'INVALID_ALGORITHM' })
    }
    if (modelType !== undefined && typeof modelType !== 'string') {
      return res.status(400).json({ error: 'modelType must be a string', code: 'INVALID_MODEL_TYPE' })
    }

    const existing = await db.botSkill.findFirst({ where: { botId: bot.id, gameId } })
    if (existing) {
      return res.status(200).json({ skill: existing, created: false })
    }

    const skill = await db.botSkill.create({
      data: {
        botId:     bot.id,
        gameId,
        algorithm,
        name:      `${bot.displayName} ${gameId.toUpperCase()}`,
        config:    {},
      },
    })

    // First-skill bots inherit this skill as their primary so existing
    // surfaces (botModelId-keyed lookups, runtime dispatch) keep working.
    if (!bot.botModelId) {
      await db.user.update({
        where: { id: bot.id },
        data:  { botModelId: skill.id, ...(modelType ? { botModelType: modelType } : {}) },
      })
    }

    cache.invalidate(BOTS_CACHE_KEY)
    res.status(201).json({ skill, created: true })
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
      id: true, username: true, displayName: true, botOwnerId: true, botActive: true,
      botInTournament: true, botModelType: true, botModelId: true, isBot: true,
      betterAuthId: true,
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

    await deleteBotCascade(db, bot)

    cache.invalidate(BOTS_CACHE_KEY)
    res.status(204).end()
  } catch (err) {
    if (err instanceof BuiltinBotProtectedError) return res.status(400).json({ error: err.message })
    if (err.code === 'P2025') return res.status(404).json({ error: 'Bot not found' })
    next(err)
  }
})

export default router
