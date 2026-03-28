import 'dotenv/config'
import http from 'http'
import path from 'path'
import fs from 'fs'
import express from 'express'
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
import puzzlesRouter from './routes/puzzles.js'
import adminRouter from './routes/admin.js'
import botsRouter from './routes/bots.js'
import botGamesRouter from './routes/botGames.js'
import { setIO as mlSetIO } from './services/mlService.js'
import { setIO as logSetIO } from './routes/logs.js'

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
  '/puzzles': puzzlesRouter,
  '/admin': adminRouter,
  '/bots': botsRouter,
  '/bot-games': botGamesRouter,
})

// Serve built frontend static files (production only — directory absent in local dev)
const publicDir = path.join(import.meta.dirname, '../public')
if (fs.existsSync(publicDir)) {
  // Hashed Vite assets — cache forever
  app.use('/assets', express.static(path.join(publicDir, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }))
  // Other static files (favicon, .well-known, etc.)
  app.use(express.static(publicDir))
  // SPA fallback — serve index.html for all non-API routes
  app.get(/^(?!\/(api|health))/, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'))
  })
  logger.info('Serving frontend static files')
}

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

attachSocketIO(server).then((io) => {
  mlSetIO(io)
  logSetIO(io)
  server.listen(PORT, () => {
    logger.info(`XO Arena backend running on port ${PORT}`)
  })
})

export default server
