/**
 * Frontend log transport.
 * - Batches log entries and ships to POST /api/v1/logs every 5s
 * - ERROR and FATAL entries are sent immediately
 * - Queues entries on network failure and retries
 * - In development, also mirrors to the browser console
 */

import { api } from './api.js'

const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
const BATCH_INTERVAL_MS = 5000

const isDev = import.meta.env.DEV

let queue = []
let retryQueue = []
let sessionId = crypto.randomUUID()

function makeEntry(level, message, meta = null) {
  return {
    timestamp: new Date().toISOString(),
    level,
    source: 'frontend',
    message,
    userId: null,   // set after auth
    sessionId,
    roomId: null,
    meta,
  }
}

async function flush(entries) {
  if (!entries.length) return
  try {
    await api.logs.ingest(entries)
  } catch {
    retryQueue.push(...entries)
  }
}

// Batch timer
setInterval(async () => {
  const batch = [...queue]
  queue = []

  const retries = [...retryQueue]
  retryQueue = []

  await flush([...retries, ...batch])
}, BATCH_INTERVAL_MS)

function log(level, message, meta) {
  const entry = makeEntry(level, message, meta)

  // Dev console mirror
  if (isDev) {
    const consoleFn = {
      DEBUG: 'debug',
      INFO: 'info',
      WARN: 'warn',
      ERROR: 'error',
      FATAL: 'error',
    }[level]
    console[consoleFn](`[${level}]`, message, meta || '')
  }

  // Immediate flush for ERROR/FATAL
  if (level === 'ERROR' || level === 'FATAL') {
    flush([entry])
  } else {
    queue.push(entry)
  }
}

export function setLogUserId(userId) {
  // Patch future entries — store userId in closure
  const originalMake = makeEntry
  Object.assign(sessionId, { userId })
}

export const logger = {
  debug: (message, meta) => log('DEBUG', message, meta),
  info: (message, meta) => log('INFO', message, meta),
  warn: (message, meta) => log('WARN', message, meta),
  error: (message, meta) => log('ERROR', message, meta),
  fatal: (message, meta) => log('FATAL', message, meta),
}
