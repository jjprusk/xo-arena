import db from '@xo-arena/db'
import logger from '../logger.js'
db.$on('query', (e) => {
  logger.info({ query: e.query, ms: e.duration }, 'db query')
})
export default db
