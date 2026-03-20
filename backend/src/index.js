import 'dotenv/config'
import http from 'http'
import app, { registerRoutes } from './app.js'
import logger from './logger.js'
import aiRouter from './routes/ai.js'
import logsRouter from './routes/logs.js'
import usersRouter from './routes/users.js'
import leaderboardRouter from './routes/leaderboard.js'
import roomsRouter from './routes/rooms.js'
import adminAiRouter from './routes/adminAi.js'
import gamesRouter from './routes/games.js'
import { attachSocketIO } from './realtime/socketHandler.js'
import mlRouter from './routes/ml.js'
import { setIO as mlSetIO } from './services/mlService.js'

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
})

const server = http.createServer(app)

attachSocketIO(server).then((io) => {
  mlSetIO(io)
  server.listen(PORT, () => {
    logger.info(`XO Arena backend running on port ${PORT}`)
  })
})

export default server
