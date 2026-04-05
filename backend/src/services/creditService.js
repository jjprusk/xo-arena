/**
 * Credit service — activity scores, tier computation, and capability limits.
 */
import db from '../lib/db.js'

async function _getSystemConfig(key, defaultValue = null) {
  const row = await db.systemConfig.findUnique({ where: { key } })
  if (!row) return defaultValue
  try { return JSON.parse(row.value) } catch { return row.value }
}

const TIER_NAMES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond']
const TIER_ICONS = ['🥉', '🥈', '🥇', '💠', '💎']

const DEFAULT_TIER_THRESHOLDS = [0, 25, 100, 500, 2000]

const DEFAULT_BOT_LIMITS = [3, 5, 8, 15, 0]
const DEFAULT_EPISODES_PER_SESSION = [1000, 5000, 20000, 50000, 100000]

const TIER_CONFIG_KEYS = [null, 'credits.tiers.silver', 'credits.tiers.gold', 'credits.tiers.platinum', 'credits.tiers.diamond']
const BOT_LIMIT_CONFIG_KEYS = ['credits.limits.bots.bronze', 'credits.limits.bots.silver', 'credits.limits.bots.gold', 'credits.limits.bots.platinum', 'credits.limits.bots.diamond']
const EPISODES_CONFIG_KEYS = ['credits.limits.episodesPerSession.bronze', 'credits.limits.episodesPerSession.silver', 'credits.limits.episodesPerSession.gold', 'credits.limits.episodesPerSession.platinum', 'credits.limits.episodesPerSession.diamond']

/**
 * Load tier thresholds from system config, falling back to defaults.
 * Returns an array of 5 numbers [bronze_min, silver_min, gold_min, platinum_min, diamond_min].
 */
async function _getTierThresholds() {
  const thresholds = [0]
  for (let i = 1; i < 5; i++) {
    const val = await _getSystemConfig(TIER_CONFIG_KEYS[i], DEFAULT_TIER_THRESHOLDS[i])
    thresholds.push(val)
  }
  return thresholds
}

/**
 * Returns the tier number (0–4) for a given activity score.
 * Reads thresholds from system config.
 */
export async function getTierForScore(score) {
  const thresholds = await _getTierThresholds()
  let tier = 0
  for (let i = 1; i < 5; i++) {
    if (score >= thresholds[i]) tier = i
  }
  return tier
}

/**
 * Returns credit totals, activity score, tier, and progress for a user.
 * Shape: { hpc, bpc, tc, activityScore, tier, tierName, tierIcon, nextTier, pointsToNextTier }
 */
export async function getUserCredits(userId) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { creditsHpc: true, creditsBpc: true, creditsTc: true },
  })
  if (!user) throw new Error(`User not found: ${userId}`)

  const hpc = user.creditsHpc
  const bpc = user.creditsBpc
  const tc = user.creditsTc

  const tcMultiplier = await _getSystemConfig('credits.tcMultiplier', 5)
  const activityScore = hpc + bpc + (tc * tcMultiplier)

  const thresholds = await _getTierThresholds()
  let tier = 0
  for (let i = 1; i < 5; i++) {
    if (activityScore >= thresholds[i]) tier = i
  }

  const tierName = TIER_NAMES[tier]
  const tierIcon = TIER_ICONS[tier]

  const nextTier = tier < 4 ? tier + 1 : null
  const pointsToNextTier = nextTier !== null ? thresholds[nextTier] - activityScore : null

  return { hpc, bpc, tc, activityScore, tier, tierName, tierIcon, nextTier, pointsToNextTier }
}

/**
 * Returns the effective limit for a given capability, respecting per-user overrides.
 * capability: 'bots' | 'episodesPerSession'
 * A limit of 0 means unlimited.
 */
export async function getTierLimit(userId, capability) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { creditsHpc: true, creditsBpc: true, creditsTc: true, botLimit: true },
  })
  if (!user) throw new Error(`User not found: ${userId}`)

  if (capability === 'bots' && user.botLimit !== null && user.botLimit !== undefined) {
    return user.botLimit
  }

  const tcMultiplier = await _getSystemConfig('credits.tcMultiplier', 5)
  const activityScore = user.creditsHpc + user.creditsBpc + (user.creditsTc * tcMultiplier)
  const tier = await getTierForScore(activityScore)

  if (capability === 'bots') {
    return await _getSystemConfig(BOT_LIMIT_CONFIG_KEYS[tier], DEFAULT_BOT_LIMITS[tier])
  }

  if (capability === 'episodesPerSession') {
    return await _getSystemConfig(EPISODES_CONFIG_KEYS[tier], DEFAULT_EPISODES_PER_SESSION[tier])
  }

  throw new Error(`Unknown capability: ${capability}`)
}
