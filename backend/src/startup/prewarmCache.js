// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Cache prewarm — runs at process boot before the HTTP server starts
 * accepting traffic.
 *
 * Why: the in-process TTL cache in `routes/bots.js` (BOTS_CACHE_KEY,
 * BOTS_GAMEID_KEY) is wiped on every backend restart. Without prewarm,
 * the first burst of post-deploy requests hits the slow DB-backed path
 * and drags p95 from ~30 ms (cache HIT) to ~150 ms (cache MISS) for the
 * full TTL window. The perf benchmark routinely captures this as a
 * "regression" against the prior cache-hot baseline.
 *
 * Populating the cache once at boot eliminates that tail. The cost is
 * a handful of DB queries during startup — Fly.io's healthcheck won't
 * flip the app to "healthy" until `server.listen` returns, so traffic
 * is gated on prewarm completing.
 *
 * No-op on prewarm failure: serving cold is strictly better than not
 * serving at all. The log line is the signal for investigation.
 */
import { listBots } from '../services/userService.js'
import { GAME_IDS } from '../constants/games.js'
import cache from '../utils/cache.js'
import logger from '../logger.js'

const BOTS_CACHE_KEY  = 'bots:public'
const BOTS_GAMEID_KEY = (gameId) => `bots:gameId:${gameId}`
const BOTS_TTL_MS     = 60_000

// Slugs to prewarm a per-game playable bot list for. Add new games here
// as they ship; populating an unused slug is cheap and only wastes a few
// KB of heap for one TTL window.
const PREWARM_GAME_IDS = [GAME_IDS.TIC_TAC_TOE]

export async function prewarmCache() {
  const started = Date.now()
  try {
    // Public active bot list — mirrors the cold path in `routes/bots.js`.
    const allActive = await listBots({ includeInactive: false })
    cache.set(BOTS_CACHE_KEY, allActive, BOTS_TTL_MS)

    // Per-game playable lists. The `/api/v1/bots?gameId=<slug>` path is
    // the hot fetch behind every guest PvAI landing — pre-populating it
    // is the single biggest win.
    for (const gameId of PREWARM_GAME_IDS) {
      const playable = allActive.filter(
        b => Array.isArray(b.playableGameIds) && b.playableGameIds.includes(gameId),
      )
      cache.set(BOTS_GAMEID_KEY(gameId), playable, BOTS_TTL_MS)
    }

    logger.info(
      { ms: Date.now() - started, bots: allActive.length, gameIds: PREWARM_GAME_IDS },
      'Cache prewarm complete',
    )
  } catch (err) {
    logger.warn({ err: err.message, ms: Date.now() - started }, 'Cache prewarm failed (non-fatal)')
  }
}
