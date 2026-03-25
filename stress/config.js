/** Shared config — override via env vars */
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
export const WS_URL   = BASE_URL.replace(/^http/, 'ws')

/**
 * A valid Better Auth JWT for an existing test user.
 * Set via env: AUTH_TOKEN=<token> k6 run ...
 * If not provided, auth-requiring endpoints are skipped gracefully.
 */
export const AUTH_TOKEN = __ENV.AUTH_TOKEN || ''

export const headers = {
  'Content-Type': 'application/json',
  ...(AUTH_TOKEN ? { 'Authorization': `Bearer ${AUTH_TOKEN}` } : {}),
}
