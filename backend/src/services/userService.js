/**
 * User service — account management and stats.
 */
import db from '../lib/db.js'
import { Prisma } from '../generated/prisma/client.ts'
import { DEFAULT_CONFIG as ML_DEFAULT_CONFIG } from '@xo-arena/ai'

const RESERVED_BOT_NAMES = ['rusty', 'copper', 'sterling', 'magnus']

/**
 * Local helper — mirrors mlService.getSystemConfig to avoid a circular import
 * (mlService already imports resetBotElo from this module).
 */
async function _getSystemConfig(key, defaultValue = null) {
  const row = await db.systemConfig.findUnique({ where: { key } })
  if (!row) return defaultValue
  try { return JSON.parse(row.value) } catch { return row.value }
}

/**
 * Find or create a domain User row.
 * Supports both Better Auth (betterAuthId) and legacy Clerk (clerkId) paths.
 * Auto-links existing Clerk users to Better Auth by email.
 */
export async function syncUser({ betterAuthId, clerkId, email, username, displayName, oauthProvider, avatarUrl }) {
  if (betterAuthId) {
    // Check if already linked by betterAuthId
    let user = await db.user.findUnique({ where: { betterAuthId } })
    if (user) {
      return db.user.update({
        where: { betterAuthId },
        data: { email, displayName, avatarUrl },
      })
    }
    // Email fallback — link an existing Clerk user row to this BA identity
    if (email) {
      user = await db.user.findUnique({ where: { email } })
      if (user) {
        return db.user.update({
          where: { email },
          data: { betterAuthId, displayName, avatarUrl },
        })
      }
    }
    // New user — create from scratch
    const safeUsername = username || email?.split('@')[0] || betterAuthId
    return db.user.create({
      data: { betterAuthId, email, username: safeUsername, displayName, oauthProvider, avatarUrl },
    })
  }

  // Legacy Clerk path (kept during cutover window)
  if (clerkId) {
    return db.user.upsert({
      where: { clerkId },
      update: { email, displayName, avatarUrl },
      create: { clerkId, email, username: username || clerkId, displayName, oauthProvider, avatarUrl },
    })
  }

  throw new Error('syncUser requires betterAuthId or clerkId')
}

/**
 * Get a user by internal ID.
 * Includes bot fields so callers can build bot profile data.
 */
export async function getUserById(id) {
  return db.user.findUnique({
    where: { id },
    include: { userRoles: { select: { role: true } } },
  })
}

/**
 * Get a user by Better Auth ID.
 */
export async function getUserByBetterAuthId(betterAuthId) {
  return db.user.findUnique({ where: { betterAuthId } })
}

/**
 * Get a user by Clerk ID (legacy — kept for cutover window).
 */
export async function getUserByClerkId(clerkId) {
  return db.user.findUnique({ where: { clerkId } })
}

/**
 * Get a bot User row by its botModelId.
 * Returns null if not found or not a bot.
 */
export async function getBotByModelId(botModelId) {
  return db.user.findFirst({ where: { botModelId, isBot: true } })
}

/**
 * Reset a bot's ELO to 1200 and mark it as calibrating.
 * Called on scratch retrain (via mlService.resetModel) or by owner/admin.
 */
export async function resetBotElo(botId) {
  return db.user.update({
    where: { id: botId },
    data: { eloRating: 1200, botEloResetAt: new Date(), botProvisional: true, botGamesPlayed: 0 },
  })
}

/**
 * Update display name or avatar.
 */
export async function updateUser(id, { displayName, avatarUrl, preferences }) {
  return db.user.update({
    where: { id },
    data: {
      ...(displayName !== undefined && { displayName }),
      ...(avatarUrl !== undefined && { avatarUrl }),
      ...(preferences !== undefined && { preferences }),
    },
  })
}

/**
 * Compute per-user stats from the Games table.
 */
export async function getUserStats(userId) {
  const [pvpGames, pvaiGames, pvbotGames, recent] = await Promise.all([
    db.game.findMany({
      where: {
        mode: 'PVP',
        OR: [{ player1Id: userId }, { player2Id: userId }],
      },
      select: { outcome: true, player1Id: true, winnerId: true },
    }),
    db.game.findMany({
      where: { mode: 'PVAI', player1Id: userId },
      select: { outcome: true, difficulty: true, winnerId: true },
    }),
    db.game.findMany({
      where: { mode: 'PVBOT', player1Id: userId },
      select: {
        outcome: true, winnerId: true, player2Id: true,
        player2: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    }),
    db.game.findMany({
      where: {
        OR: [{ player1Id: userId }, { player2Id: userId }],
      },
      orderBy: { endedAt: 'desc' },
      take: 20,
      select: {
        outcome: true,
        winnerId: true,
        mode: true,
        difficulty: true,
        endedAt: true,
        roomName: true,
        player2: { select: { displayName: true, isBot: true } },
      },
    }),
  ])

  const allGames = [...pvpGames, ...pvaiGames, ...pvbotGames]
  const totalGames = allGames.length
  const wins = allGames.filter((g) => g.winnerId === userId).length
  const draws = allGames.filter((g) => g.outcome === 'DRAW').length
  const losses = totalGames - wins - draws
  const winRate = totalGames > 0 ? wins / totalGames : 0

  // Win rate by mode/difficulty
  const pvpWins = pvpGames.filter((g) => g.winnerId === userId).length
  const pvpRate = pvpGames.length > 0 ? pvpWins / pvpGames.length : 0

  const pvaiByDiff = {}
  for (const diff of ['NOVICE', 'INTERMEDIATE', 'ADVANCED', 'MASTER']) {
    const games = pvaiGames.filter((g) => g.difficulty === diff)
    const w = games.filter((g) => g.winnerId === userId).length
    pvaiByDiff[diff.toLowerCase()] = {
      played: games.length,
      wins: w,
      rate: games.length > 0 ? w / games.length : 0,
    }
  }

  // PVBOT stats grouped by opponent bot
  const pvbotByBot = {}
  for (const g of pvbotGames) {
    const botId = g.player2Id
    if (!botId) continue
    if (!pvbotByBot[botId]) {
      pvbotByBot[botId] = {
        bot: g.player2 ? { id: g.player2.id, displayName: g.player2.displayName, avatarUrl: g.player2.avatarUrl } : { id: botId },
        played: 0,
        wins: 0,
        rate: 0,
      }
    }
    pvbotByBot[botId].played++
    if (g.winnerId === userId) pvbotByBot[botId].wins++
  }
  for (const entry of Object.values(pvbotByBot)) {
    entry.rate = entry.played > 0 ? entry.wins / entry.played : 0
  }

  return {
    totalGames,
    wins,
    losses,
    draws,
    winRate,
    pvp: { played: pvpGames.length, wins: pvpWins, rate: pvpRate },
    pvai: pvaiByDiff,
    pvbot: {
      played: pvbotGames.length,
      wins: pvbotGames.filter((g) => g.winnerId === userId).length,
      rate: pvbotGames.length > 0 ? pvbotGames.filter((g) => g.winnerId === userId).length / pvbotGames.length : 0,
      byBot: pvbotByBot,
    },
    recentGames: recent,
  }
}

/**
 * Compute stats for a bot from the bot's perspective.
 * Queries games where the bot is player2 (PVBOT challenges).
 * Returns win rates vs humans and vs other bots separately.
 */
export async function getBotStats(botId) {
  const games = await db.game.findMany({
    where: { player2Id: botId, mode: 'PVBOT' },
    select: {
      outcome: true, winnerId: true, player1Id: true,
      player1: { select: { isBot: true } },
    },
  })

  const vsHumans = games.filter((g) => !g.player1?.isBot)
  const vsBots = games.filter((g) => g.player1?.isBot)

  const calc = (list) => {
    const played = list.length
    const wins = list.filter((g) => g.winnerId === botId).length
    const draws = list.filter((g) => g.outcome === 'DRAW').length
    return { played, wins, draws, losses: played - wins - draws, rate: played > 0 ? wins / played : 0 }
  }

  return {
    total: games.length,
    vsHumans: calc(vsHumans),
    vsBots: calc(vsBots),
  }
}

/**
 * Get the global leaderboard (top 50 by win rate, minimum 1 game).
 * Uses a single CTE query instead of 4 Prisma round trips.
 */
export async function getLeaderboard({ period = 'all', mode = 'all', limit = 50, includeBots = false } = {}) {
  const whereMode = mode === 'pvp' ? 'PVP' : mode === 'pvai' ? 'PVAI' : null

  // Prisma.sql fragments for optional filters — interpolated safely as SQL, not parameters
  const modeFilter = whereMode ? Prisma.sql`AND g.mode = ${whereMode}::"GameMode"` : Prisma.empty
  const botFilter  = includeBots ? Prisma.empty : Prisma.sql`AND u."isBot" = false`

  const rows = await db.$queryRaw`
    WITH counts AS (
      SELECT player_id, SUM(games) AS total, SUM(wins) AS wins
      FROM (
        SELECT g."player1Id" AS player_id,
               COUNT(*)                                                AS games,
               COUNT(*) FILTER (WHERE g."winnerId" = g."player1Id")   AS wins
        FROM games g
        WHERE true ${modeFilter}
        GROUP BY g."player1Id"
        UNION ALL
        SELECT g."player2Id" AS player_id,
               COUNT(*)                                                AS games,
               COUNT(*) FILTER (WHERE g."winnerId" = g."player2Id")   AS wins
        FROM games g
        WHERE g."player2Id" IS NOT NULL ${modeFilter}
        GROUP BY g."player2Id"
      ) sub
      GROUP BY player_id
    )
    SELECT u.id,
           u."displayName",
           u."avatarUrl",
           u."isBot",
           c.total,
           c.wins,
           ROUND(c.wins::numeric / NULLIF(c.total, 0), 4) AS win_rate
    FROM counts c
    JOIN users u ON u.id = c.player_id
    WHERE c.total >= 1 ${botFilter}
    ORDER BY win_rate DESC, c.total DESC
    LIMIT ${limit}
  `

  // COUNT/SUM return BigInt from the Postgres driver — coerce to Number for JSON safety.
  return rows.map((row, i) => ({
    rank: i + 1,
    user: {
      id: row.id,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      isBot: row.isBot,
    },
    total:   Number(row.total),
    wins:    Number(row.wins),
    winRate: Number(row.win_rate),
  }))
}

/**
 * Create a bot user row owned by the given user.
 * Enforces reserved name, profanity, and deduplication rules.
 */
const VALID_ML_ALGORITHMS = ['Q_LEARNING', 'SARSA', 'MONTE_CARLO', 'POLICY_GRADIENT', 'DQN', 'ALPHA_ZERO']

export async function createBot(ownerId, { name, algorithm, difficulty, modelType, competitive, avatarUrl } = {}) {
  if (!name || !name.trim()) throw Object.assign(new Error('Bot name is required'), { code: 'INVALID_NAME' })
  const trimmedName = name.trim()

  // 1. Reserved name check (case-insensitive)
  if (RESERVED_BOT_NAMES.includes(trimmedName.toLowerCase())) {
    throw Object.assign(new Error(`"${trimmedName}" is a reserved name`), { code: 'RESERVED_NAME' })
  }

  // 2. Profanity check
  const profanityList = await _getSystemConfig('bots.profanityList', [])
  if (Array.isArray(profanityList) && profanityList.length > 0) {
    const lower = trimmedName.toLowerCase()
    for (const word of profanityList) {
      if (lower.includes(word.toLowerCase())) {
        throw Object.assign(new Error('Bot name contains disallowed content'), { code: 'PROFANITY' })
      }
    }
  }

  // 3. Name dedup: find all existing bot display names (case-insensitive)
  const existingBots = await db.user.findMany({
    where: { isBot: true },
    select: { displayName: true },
  })
  const existingNames = new Set(existingBots.map(b => b.displayName.toLowerCase()))

  let finalName = trimmedName
  if (existingNames.has(finalName.toLowerCase())) {
    let suffix = 1
    while (existingNames.has(`${trimmedName.toLowerCase()}${suffix}`)) {
      suffix++
    }
    finalName = `${trimmedName}${suffix}`
  }

  // 4. Validate algorithm and resolve ML algo
  const alg = algorithm || 'minimax'
  const diff = difficulty || 'novice'
  let mlAlgo = null

  if (alg === 'minimax' || alg === 'mcts' || alg === 'rule_based') {
    // handled below
  } else if (alg === 'ml') {
    mlAlgo = (modelType || 'DQN').toUpperCase().replace(/-/g, '_')
    if (!VALID_ML_ALGORITHMS.includes(mlAlgo)) {
      throw Object.assign(new Error(`Unknown ML algorithm: ${modelType}`), { code: 'INVALID_ALGORITHM' })
    }
  } else {
    throw Object.assign(new Error(`Unknown algorithm: ${alg}`), { code: 'INVALID_ALGORITHM' })
  }

  // 5. Competitive flag: only honored for ml bots
  const botCompetitive = alg === 'ml' ? Boolean(competitive) : false

  // 6. Generate unique username slug
  const slugBase = `bot_${finalName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`
  const existingUsernames = await db.user.findMany({
    where: { username: { startsWith: slugBase } },
    select: { username: true },
  })
  const usedUsernames = new Set(existingUsernames.map(u => u.username))
  let username = slugBase
  if (usedUsernames.has(username)) {
    let i = 1
    while (usedUsernames.has(`${slugBase}_${i}`)) i++
    username = `${slugBase}_${i}`
  }
  const email = `${username}@xo-arena.internal`

  // 7. Resolve botModelId (synthetic for minimax/mcts, real FK for ml)
  // For ML bots, create the model and bot atomically so we never orphan a model.
  if (alg === 'ml') {
    const maxEpisodes = await _getSystemConfig('ml.maxEpisodesPerModel', 100_000)
    return db.$transaction(async (tx) => {
      const model = await tx.mLModel.create({
        data: {
          name: finalName,
          algorithm: mlAlgo,
          qtable: {},
          config: { ...ML_DEFAULT_CONFIG },
          createdBy: ownerId,
          maxEpisodes,
        },
      })
      return tx.user.create({
        data: {
          username,
          email,
          displayName: finalName,
          avatarUrl: avatarUrl ?? null,
          isBot: true,
          botModelType: alg,
          botModelId: model.id,
          botOwnerId: ownerId,
          botActive: true,
          botCompetitive,
          botProvisional: true,
        },
      })
    })
  }

  const botModelId =
    alg === 'minimax' ? `user:${ownerId}:minimax:${diff}` :
    alg === 'mcts'    ? `user:${ownerId}:mcts:${diff}` :
    /* rule_based */    `user:${ownerId}:rule_based:default`

  // 8. Create the bot user row
  return db.user.create({
    data: {
      username,
      email,
      displayName: finalName,
      avatarUrl: avatarUrl ?? null,
      isBot: true,
      botModelType: alg,
      botModelId,
      botOwnerId: ownerId,
      botActive: true,
      botCompetitive,
      botProvisional: true,
    },
  })
}

/**
 * List bot users.
 * @param {{ ownerId?: string, includeInactive?: boolean }} options
 */
export async function listBots({ ownerId, includeInactive = false } = {}) {
  const where = {
    isBot: true,
    ...(ownerId ? { botOwnerId: ownerId } : {}),
    ...(includeInactive ? {} : { botActive: true }),
  }
  return db.user.findMany({
    where,
    select: {
      id: true,
      displayName: true,
      avatarUrl: true,
      eloRating: true,
      botModelType: true,
      botModelId: true,
      botActive: true,
      botCompetitive: true,
      botProvisional: true,
      botGamesPlayed: true,
      botInTournament: true,
      botOwnerId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Check whether a bot is eligible for tournament participation.
 * Returns { eligible: true } or { eligible: false, reason: string }.
 */
export async function checkBotEligibility(botId) {
  const bot = await db.user.findUnique({
    where: { id: botId },
    select: { isBot: true, botActive: true, botAvailable: true, botInTournament: true },
  })
  if (!bot || !bot.isBot) return { eligible: false, reason: 'Bot not found' }
  if (!bot.botActive)      return { eligible: false, reason: 'Bot is inactive' }
  if (!bot.botAvailable)   return { eligible: false, reason: 'Bot is not available for tournaments' }
  if (bot.botInTournament) return { eligible: false, reason: 'Bot is already in a tournament' }

  const minGames = await _getSystemConfig('bots.minGamesForTournament', 10)
  const gamesPlayed = await db.game.count({
    where: { OR: [{ player1Id: botId }, { player2Id: botId }] },
  })
  if (gamesPlayed < minGames) {
    return { eligible: false, reason: `Bot needs at least ${minGames} games (has ${gamesPlayed})` }
  }

  return { eligible: true }
}

/**
 * Record a completed game.
 */
export async function createGame({
  player1Id,
  player2Id = null,
  winnerId = null,
  mode,           // 'PVP' | 'PVAI' | 'PVBOT'
  outcome,        // 'PLAYER1_WIN' | 'PLAYER2_WIN' | 'AI_WIN' | 'DRAW'
  difficulty = null,
  aiImplementationId = null,
  totalMoves,
  durationMs,
  startedAt,
  roomName = null,
}) {
  return db.game.create({
    data: {
      player1Id,
      player2Id,
      winnerId,
      mode,
      outcome,
      difficulty,
      aiImplementationId,
      totalMoves,
      durationMs,
      startedAt: new Date(startedAt),
      endedAt: new Date(),
      roomName,
    },
  })
}
