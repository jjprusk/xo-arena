/**
 * Returns a signed JWT bearer token from the Better Auth JWT plugin endpoint.
 *
 * Works in both React and non-React contexts (Zustand actions, fetch helpers, etc.).
 * The token is fetched from /api/auth/token — a relative URL that resolves to the
 * correct backend for any site in the platform family (via Vite proxy in dev,
 * same origin in production).
 *
 * Caching behaviour:
 *   - Token cached in memory until 60 seconds before its JWT expiry.
 *   - Negative-cached for 10 seconds after a 401 to avoid hammering the endpoint.
 */

let _cachedToken = null
let _tokenExpiry = 0
let _nullUntil   = 0

function decodeExpiry(jwt) {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return (payload.exp ?? 0) * 1000
  } catch { return 0 }
}

export async function getToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) return _cachedToken
  if (Date.now() < _nullUntil) return null
  try {
    const res = await fetch('/api/auth/token', { method: 'GET', credentials: 'include' })
    if (!res.ok) { _cachedToken = null; _nullUntil = Date.now() + 10_000; return null }
    const data = await res.json()
    const token = data?.token ?? null
    if (token) {
      _cachedToken = token
      _tokenExpiry = decodeExpiry(token)
    }
    return token
  } catch {
    return null
  }
}

export function clearTokenCache() {
  _cachedToken = null
  _tokenExpiry = 0
  _nullUntil   = 0
}
