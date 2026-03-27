/**
 * User service — account management and stats.
 */
import db from '../lib/db.js'

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
    data: { eloRating: 1200, botEloResetAt: new Date(), botCalibrating: true },
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
  const [pvpGames, pvaiGames, pvbotGames] = await Promise.all([
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

  // Last 20 games for streak grid (include bot display name for PVBOT)
  const recent = await db.game.findMany({
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
  })

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
    select: { outcome: true, winnerId: true, player1Id: true },
    include: { player1: { select: { isBot: true } } },
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
 * Get the global leaderboard (top 50 by win rate, minimum 5 games).
 */
export async function getLeaderboard({ period = 'all', mode = 'all', limit = 50, includeBots = false } = {}) {
  const whereMode = mode === 'pvp' ? 'PVP' : mode === 'pvai' ? 'PVAI' : undefined

  // Aggregate wins and total games per player
  const modeWhere = whereMode ? { mode: whereMode } : {}

  const [winners, asPlayer1, asPlayer2] = await Promise.all([
    db.game.groupBy({
      by: ['winnerId'],
      where: { winnerId: { not: null }, ...modeWhere },
      _count: { id: true },
    }),
    db.game.groupBy({
      by: ['player1Id'],
      where: modeWhere,
      _count: { id: true },
    }),
    db.game.groupBy({
      by: ['player2Id'],
      where: { player2Id: { not: null }, ...modeWhere },
      _count: { id: true },
    }),
  ])

  const winMap = new Map(winners.map((w) => [w.winnerId, w._count.id]))

  // Merge player1 and player2 game counts into a single total per user
  const totalMap = new Map(asPlayer1.map((r) => [r.player1Id, r._count.id]))
  for (const r of asPlayer2) {
    totalMap.set(r.player2Id, (totalMap.get(r.player2Id) || 0) + r._count.id)
  }

  const allUserIds = [...totalMap.keys()]
  const users = await db.user.findMany({
    where: {
      id: { in: allUserIds },
      ...(includeBots ? {} : { isBot: false }),
    },
    select: { id: true, displayName: true, avatarUrl: true, isBot: true },
  })
  const userMap = new Map(users.map((u) => [u.id, u]))

  const entries = [...totalMap.entries()]
    .filter(([userId, total]) => total >= 1 && userMap.has(userId))
    .map(([userId, total]) => ({
      userId,
      total,
      wins: winMap.get(userId) || 0,
      winRate: winMap.get(userId) ? winMap.get(userId) / total : 0,
    }))
    .sort((a, b) => b.winRate - a.winRate || b.total - a.total)
    .slice(0, limit)

  return entries.map((e, i) => ({
    rank: i + 1,
    user: userMap.get(e.userId) || { id: e.userId, displayName: 'Unknown', avatarUrl: null, isBot: false },
    total: e.total,
    wins: e.wins,
    winRate: e.winRate,
  }))
}

/**
 * Create a bot user row owned by the given user.
 * Enforces reserved name, profanity, and deduplication rules.
 */
export async function createBot(ownerId, { name, algorithm, difficulty, modelId, competitive, avatarUrl } = {}) {
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

  // 4. Determine botModelId
  let botModelId
  const alg = algorithm || 'minimax'
  const diff = difficulty || 'novice'
  if (alg === 'minimax') {
    botModelId = `user:${ownerId}:minimax:${diff}`
  } else if (alg === 'mcts') {
    botModelId = `user:${ownerId}:mcts:${diff}`
  } else if (alg === 'ml') {
    if (!modelId) throw Object.assign(new Error('modelId is required for ML bots'), { code: 'INVALID_MODEL' })
    botModelId = modelId
  } else if (alg === 'rule_based') {
    botModelId = `user:${ownerId}:rule_based:${modelId || 'default'}`
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

  // 7. Create the bot user row
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
      botCalibrating: true,
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
      botCalibrating: true,
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
