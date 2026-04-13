// Copyright © 2026 Joe Pruskowski. All rights reserved.
import Redis from 'ioredis'
import logger from '../logger.js'

let _redis = null

function getRedis() {
  if (!_redis) {
    if (!process.env.REDIS_URL) {
      logger.warn('REDIS_URL not set — Redis publish disabled')
      return null
    }
    _redis = new Redis(process.env.REDIS_URL)
    _redis.on('error', err => logger.error({ err }, 'Redis error'))
  }
  return _redis
}

export async function publish(channel, payload) {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.publish(channel, JSON.stringify(payload))
  } catch (err) {
    logger.error({ err, channel }, 'Redis publish failed')
  }
}
