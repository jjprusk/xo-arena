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
import { startTournamentSweep } from './lib/tournamentSweep.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'))
const PORT = process.env.PORT || 3001

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
})

export default server
