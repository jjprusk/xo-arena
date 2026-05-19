// Copyright © 2026 Joe Pruskowski. All rights reserved.
import 'dotenv/config'
import http from 'http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import app, { registerRoutes } from './app.js'
import logger from './logger.js'
import db from './lib/db.js'
import { runSeed } from '../prisma/seed.js'
import { seedCorpus as seedHelpCorpus, reindexAllIfStale as reindexHelpCorpusIfStale } from './services/help/corpusSeeder.js'
import { startHelpRateLimitSweep } from './middleware/helpRateLimit.js'
import { startResearchPublishRateLimitSweep } from './middleware/researchPublishRateLimit.js'
import { startResearchLogExportCron } from './jobs/researchLogExport.js'
import { prewarmCache } from './startup/prewarmCache.js'
import { resumeOrphanedSessions } from './services/mlService.js'
import aiRouter from './routes/ai.js'
import logsRouter from './routes/logs.js'
import usersRouter from './routes/users.js'
import leaderboardRouter from './routes/leaderboard.js'
// roomsRouter removed in Phase 3.4 — Tables are the only game primitive
import adminAiRouter from './routes/adminAi.js'
import gamesRouter from './routes/games.js'
import mlRouter from './routes/ml.js'
import skillsRouter from './routes/skills.js'
import puzzlesRouter from './routes/puzzles.js'
import adminRouter from './routes/admin.js'
import adminPerfBaselinesRouter from './routes/adminPerfBaselines.js'
import helpAdminRouter from './routes/helpAdmin.js'
import helpRouter from './routes/help.js'
import researchRouter from './routes/research.js'
import botsRouter from './routes/bots.js'
import botGamesRouter from './routes/botGames.js'
import feedbackRouter from './routes/feedback.js'
import supportRouter from './routes/support.js'
import guideRouter from './routes/guide.js'
import tablesRouter from './routes/tables.js'
import tournamentMatchesRouter from './routes/tournamentMatches.js'
import eventsRouter from './routes/events.js'
import presenceRouter from './routes/presence.js'
import pushRouter from './routes/push.js'
import realtimeRouter, { modeRouter as realtimeModeRouter } from './routes/realtime.js'
import playRouter from './routes/play.js'
import perfVitalsRouter from './routes/perfVitals.js'
import swControlRouter from './routes/swControl.js'
import { validateGameSlug } from './middleware/gameSlug.js'
import { getSystemConfig } from './services/skillService.js'
import { startActivityFlushJob } from './services/activityService.js'
import { startReplayPurgeJob } from './services/replayPurgeService.js'
import { startIdleSessionPurgeJob } from './services/idleSessionPurgeService.js'
import { startTournamentBridge } from './lib/tournamentBridge.js'
import { startExpiredNotificationPruner } from './lib/notificationBus.js'
import { startDispatcher } from './lib/scheduledJobs.js'
import { start as startTableGc } from './services/tableGcService.js'
import { startMetricsSnapshotCron } from './services/metricsSnapshotService.js'

const PORT = process.env.PORT || 3000

// A1.4 — game-as-prefix route layer. Registered BEFORE the flat mounts below
// so /api/v1/games/:slug/<sub> takes precedence over /api/v1/games's other
// routes. Each prefix mount runs the slug validator first; unknown slugs 404
// cleanly. Inner handlers read req.gameId (set by validator); req.query.gameId
// is also injected for back-compat with handlers that pre-date the prefix.
//
// "Pure" game-scoped routers (bots, play, skills, ml, puzzles, leaderboard)
// are the natural prefix consumers. "Dual-addressable" routers (tables, the
// renamed game-results) are reachable BOTH via the prefix (per-game scope)
// AND via their flat mounts below (cross-game scope, used by admin views).
registerRoutes(app, {
  '/games/:slug/bots':         [validateGameSlug, botsRouter],
  '/games/:slug/play':         [validateGameSlug, playRouter],
  '/games/:slug/skills':       [validateGameSlug, skillsRouter],
  '/games/:slug/ml':           [validateGameSlug, mlRouter],
  '/games/:slug/puzzles':      [validateGameSlug, puzzlesRouter],
  '/games/:slug/leaderboard':  [validateGameSlug, leaderboardRouter],
  '/games/:slug/tables':       [validateGameSlug, tablesRouter],
  '/games/:slug/results':      [validateGameSlug, gamesRouter],
})

registerRoutes(app, {
  '/ai': aiRouter,
  '/logs': logsRouter,
  '/users': usersRouter,
  '/leaderboard': leaderboardRouter,
  // '/rooms' removed in Phase 3.4 — Tables are the only game primitive
  '/admin/ai': adminAiRouter,
  '/admin/perf': adminPerfBaselinesRouter,
  '/admin/help': helpAdminRouter,
  '/help':       helpRouter,
  '/research':   researchRouter,
  // /game-results is the canonical mount for game-result records (POST /, GET /,
  // GET /:id/replay). The legacy /games mount is kept for back-compat until A1.9
  // adds 301s. The name games-as-records was historically confusing; game-results
  // is unambiguous and frees the /games namespace for the prefix router above.
  '/game-results': gamesRouter,
  '/games': gamesRouter,
  '/ml': mlRouter,
  '/skills': skillsRouter,
  '/puzzles': puzzlesRouter,
  '/admin': adminRouter,
  '/bots': botsRouter,
  '/bot-games': botGamesRouter,
  '/feedback': feedbackRouter,
  '/support': supportRouter,
  '/guide': guideRouter,
  '/tables': tablesRouter,
  '/tournament-matches': tournamentMatchesRouter,
  '/events':             eventsRouter,
  '/presence':           presenceRouter,
  '/push':               pushRouter,
  '/rt':                 realtimeRouter,
  '/play':               playRouter,
  '/realtime':           realtimeModeRouter,
  '/perf':               perfVitalsRouter,
  '/config/sw':          swControlRouter,
})

// Public version endpoint — no auth required
const __dirname = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'))
app.get('/api/version', (_req, res) => {
  res.json({ version })
})

// Public config endpoints (no auth required)
app.get('/api/v1/config/aivai', async (_req, res) => {
  try {
    const maxGames = await getSystemConfig('aivai.maxGames', 5)
    res.json({ maxGames })
  } catch {
    res.json({ maxGames: 5 })
  }
})

app.get('/api/v1/config/session-idle', async (_req, res) => {
  try {
    const [idleWarnMinutes, idleGraceMinutes] = await Promise.all([
      getSystemConfig('session.idleWarnMinutes',  30),
      getSystemConfig('session.idleGraceMinutes',  5),
    ])
    res.json({ idleWarnMinutes, idleGraceMinutes })
  } catch {
    res.json({ idleWarnMinutes: 30, idleGraceMinutes: 5 })
  }
})

const server = http.createServer(app)

// Seed DB (idempotent — safe to run on every startup)
try {
  await runSeed()
  logger.info('DB seed complete')
} catch (err) {
  logger.warn({ err: err.message }, 'DB seed failed (non-fatal)')
}

// Seed the Help corpus from /doc/Help_Corpus (additive — never overwrites
// existing slugs). DB is canonical after seed; admin editor handles updates.
try {
  const r = await seedHelpCorpus()
  if (r.inserted > 0) logger.info(r, 'Help corpus seeded')
} catch (err) {
  logger.warn({ err: err.message }, 'Help corpus seed failed (non-fatal)')
}

// Auto-reindex if the corpus contains chunks embedded under a different
// model than the one this process would write. Triggers on the first boot
// after Sprint 2's stub → OpenAI cutover (all Sprint-1 chunks tagged
// 'stub') and again on any future embedding-model upgrade. No-op in stub
// mode (test/offline). See corpusSeeder.reindexAllIfStale for details.
try {
  const r = await reindexHelpCorpusIfStale()
  if (!r.skipped) {
    logger.info(r, 'Help corpus: auto-reindex complete on boot')
  }
} catch (err) {
  logger.warn({ err: err.message }, 'Help corpus auto-reindex failed (non-fatal — old vectors remain in place)')
}

// Pre-warm the DB connection pool so first requests don't pay connection cost
db.$connect().catch((err) => logger.warn('DB pre-connect failed', { err }))

// Start background activity flush job (Redis → Postgres)
startActivityFlushJob()
startReplayPurgeJob()
startIdleSessionPurgeJob()
startDispatcher()
startExpiredNotificationPruner()
startMetricsSnapshotCron()
startHelpRateLimitSweep()
startResearchPublishRateLimitSweep()
startResearchLogExportCron()

// SSE+POST is the only realtime transport (Realtime_Migration_Plan.md
// Phase 8). socket.io was removed in this commit.
app.set('io', null)
startTournamentBridge(null)
startTableGc(null)

// Prewarm the in-process bots cache before serving traffic. Without this,
// the first burst of post-deploy requests hits the cold path and drags
// `/api/v1/bots?gameId=...` p95 from ~30 ms to ~150 ms for the full TTL
// window. Awaited so server.listen() (and thus Fly.io's healthcheck) only
// flips to ready after the cache is warm.
await prewarmCache()

// A3a.9 — pick up any training sessions left RUNNING by a crashed worker.
// Fire-and-forget: we never want a slow resume scan to block the listen()
// call. Each session is recovered or marked FAILED independently.
resumeOrphanedSessions().catch((err) =>
  logger.error({ err }, 'orphaned training resume failed')
)

server.listen(PORT, () => {
  logger.info(`XO Arena backend running on port ${PORT}`)
})

export default server
