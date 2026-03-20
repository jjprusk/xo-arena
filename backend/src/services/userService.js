/**
 * User service — account management and stats.
 */
import db from '../lib/db.js'

/**
 * Find or create a user from Clerk identity.
 * Called on first authenticated request after login.
 */
export async function syncUser({ clerkId, email, username, displayName, oauthProvider, avatarUrl }) {
  const user = await db.user.upsert({
    where: { clerkId },
    update: { email, displayName, avatarUrl },
    create: { clerkId, email, username, displayName, oauthProvider, avatarUrl },
  })
  return user
}

/**
 * Get a user by internal ID.
 */
export async function getUserById(id) {
  return db.user.findUnique({ where: { id } })
}

/**
 * Get a user by Clerk ID.
 */
export async function getUserByClerkId(clerkId) {
  return db.user.findUnique({ where: { clerkId } })
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
  const [pvpGames, pvaiGames] = await Promise.all([
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
  ])

  const allGames = [...pvpGames, ...pvaiGames]
  const totalGames = allGames.length
  const wins = allGames.filter((g) => g.winnerId === userId).length
  const draws = allGames.filter((g) => g.outcome === 'DRAW').length
  const losses = totalGames - wins - draws
  const winRate = totalGames > 0 ? wins / totalGames : 0

  // Win rate by mode/difficulty
  const pvpWins = pvpGames.filter((g) => g.winnerId === userId).length
  const pvpRate = pvpGames.length > 0 ? pvpWins / pvpGames.length : 0

  const pvaiByDiff = {}
  for (const diff of ['EASY', 'MEDIUM', 'HARD']) {
    const games = pvaiGames.filter((g) => g.difficulty === diff)
    const w = games.filter((g) => g.winnerId === userId).length
    pvaiByDiff[diff.toLowerCase()] = {
      played: games.length,
      wins: w,
      rate: games.length > 0 ? w / games.length : 0,
    }
  }

  // Last 20 games for streak grid
  const recent = await db.game.findMany({
    where: {
      OR: [{ player1Id: userId }, { player2Id: userId }],
    },
    orderBy: { endedAt: 'desc' },
    take: 20,
    select: { outcome: true, winnerId: true, mode: true, difficulty: true, endedAt: true, roomName: true },
  })

  return {
    totalGames,
    wins,
    losses,
    draws,
    winRate,
    pvp: { played: pvpGames.length, wins: pvpWins, rate: pvpRate },
    pvai: pvaiByDiff,
    recentGames: recent,
  }
}

/**
 * Get the global leaderboard (top 50 by win rate, minimum 5 games).
 */
export async function getLeaderboard({ period = 'all', mode = 'all', limit = 50 } = {}) {
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

  const entries = [...totalMap.entries()]
    .filter(([, total]) => total >= 1)
    .map(([userId, total]) => ({
      userId,
      total,
      wins: winMap.get(userId) || 0,
      winRate: winMap.get(userId) ? winMap.get(userId) / total : 0,
    }))
    .sort((a, b) => b.winRate - a.winRate || b.total - a.total)
    .slice(0, limit)

  const userIds = entries.map((e) => e.userId)
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, displayName: true, avatarUrl: true },
  })
  const userMap = new Map(users.map((u) => [u.id, u]))

  return entries.map((e, i) => ({
    rank: i + 1,
    user: userMap.get(e.userId) || { id: e.userId, displayName: 'Unknown', avatarUrl: null },
    total: e.total,
    wins: e.wins,
    winRate: e.winRate,
  }))
}

/**
 * Record a completed game.
 */
export async function createGame({
  player1Id,
  player2Id = null,
  winnerId = null,
  mode,           // 'PVP' | 'PVAI'
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
