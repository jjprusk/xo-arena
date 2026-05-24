// Copyright © 2026 Joe Pruskowski. All rights reserved.
import 'dotenv/config'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import app, { registerRoutes } from './app.js'
import logger from './logger.js'
import db from './lib/db.js'
import tournamentsRouter from './routes/tournaments.js'
import matchesRouter from './routes/matches.js'
import classificationRouter from './routes/classification.js'
import recurringRouter from './routes/recurring.js'
import botMatchesRouter from './routes/botMatches.js'
import { validateGameSlug } from './middleware/gameSlug.js'
import { startTournamentSweep } from './lib/tournamentSweep.js'
import { startRecurringScheduler } from './lib/recurringScheduler.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'))
const PORT = process.env.PORT || 3001

// A1.4 — game-as-prefix routes. Registered first so /api/games/:slug/<sub>
// matches before the flat mounts below. See backend/src/middleware/gameSlug.js
// for full behavior; tournament data is game-scoped (every Tournament/Match
// row has a gameId), so the prefix lets callers scope queries by URL.
registerRoutes(app, {
  '/games/:slug/tournaments':    [validateGameSlug, tournamentsRouter],
  '/games/:slug/matches':        [validateGameSlug, matchesRouter],
  '/games/:slug/classification': [validateGameSlug, classificationRouter],
  '/games/:slug/recurring':      [validateGameSlug, recurringRouter],
  '/games/:slug/bot-matches':    [validateGameSlug, botMatchesRouter],
})

registerRoutes(app, {
  '/tournaments': tournamentsRouter,
  '/matches': matchesRouter,
  '/classification': classificationRouter,
  '/recurring': recurringRouter,
  '/bot-matches': botMatchesRouter,
})

// Public version endpoint

app.get('/api/version', (_req, res) => res.json({ version }))

const server = http.createServer(app)

db.$connect().catch(err => logger.warn('DB pre-connect failed', { err }))

server.listen(PORT, () => {
  logger.info(`Tournament service running on port ${PORT}`)
  startTournamentSweep()
  startRecurringScheduler()
})

export default server
