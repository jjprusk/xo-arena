import Redis from 'ioredis'
import logger from '../logger.js'

let _client = null

export function getRedis() {
  if (!_client) {
    if (!process.env.REDIS_URL) {
      logger.warn('REDIS_URL not set — tournament events will not be published')
      return null
    }
    _client = new Redis(process.env.REDIS_URL)
    _client.on('error', err => logger.error({ err }, 'Redis error'))
  }
  return _client
}

export async function publishEvent(channel, data) {
  const redis = getRedis()
  if (!redis) return
  await redis.publish(channel, JSON.stringify(data))
}
