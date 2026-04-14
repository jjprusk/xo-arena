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
import aiRouter from './routes/ai.js'
import logsRouter from './routes/logs.js'
import usersRouter from './routes/users.js'
import leaderboardRouter from './routes/leaderboard.js'
import roomsRouter from './routes/rooms.js'
import adminAiRouter from './routes/adminAi.js'
import gamesRouter from './routes/games.js'
import { attachSocketIO } from './realtime/socketHandler.js'
import mlRouter from './routes/ml.js'
import skillsRouter from './routes/skills.js'
import puzzlesRouter from './routes/puzzles.js'
import adminRouter from './routes/admin.js'
import botsRouter from './routes/bots.js'
import botGamesRouter from './routes/botGames.js'
import feedbackRouter from './routes/feedback.js'
import supportRouter from './routes/support.js'
import guideRouter from './routes/guide.js'
import { setIO as mlSetIO, getSystemConfig } from './services/skillService.js'
import { setIO as logSetIO } from './routes/logs.js'
import { setIO as journeySetIO } from './services/journeyService.js'
import { startActivityFlushJob } from './services/activityService.js'
import { startReplayPurgeJob } from './services/replayPurgeService.js'
import { startIdleSessionPurgeJob } from './services/idleSessionPurgeService.js'
import { startTournamentBridge } from './lib/tournamentBridge.js'
import { initBus } from './lib/notificationBus.js'
import { startDispatcher, setIO as schedulerSetIO } from './lib/scheduledJobs.js'

const PORT = process.env.PORT || 3000

registerRoutes(app, {
  '/ai': aiRouter,
  '/logs': logsRouter,
  '/users': usersRouter,
  '/leaderboard': leaderboardRouter,
  '/rooms': roomsRouter,
  '/admin/ai': adminAiRouter,
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

// Pre-warm the DB connection pool so first requests don't pay connection cost
db.$connect().catch((err) => logger.warn('DB pre-connect failed', { err }))

// Start background activity flush job (Redis → Postgres)
startActivityFlushJob()
startReplayPurgeJob()
startIdleSessionPurgeJob()
startDispatcher()

attachSocketIO(server).then((io) => {
  app.set('io', io)
  mlSetIO(io)
  logSetIO(io)
  journeySetIO(io)
  schedulerSetIO(io)
  startTournamentBridge(io)
  initBus(io)
  server.listen(PORT, () => {
    logger.info(`XO Arena backend running on port ${PORT}`)
  })
})

export default server
