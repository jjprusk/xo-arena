import 'dotenv/config'
import app from './app.js'
import logger from './logger.js'
import { startScheduler } from './lib/scheduler.js'
import { startBotWorker } from './lib/botWorker.js'

const PORT = process.env.PORT || 3001

app.listen(PORT, () => {
  logger.info(`Tournament service running on port ${PORT}`)
  startScheduler()
  startBotWorker()
})
