// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Returns a signed JWT bearer token from the Better Auth JWT plugin endpoint.
 * Works in both React components and non-React contexts (Zustand, etc.).
 *
 * The token is cached in memory until 60s before its expiry, so repeated calls
 * (e.g. every page navigation) cost 0ms instead of a full network round-trip.
 */

let _cachedToken = null
let _tokenExpiry = 0
let _nullUntil   = 0   // negative cache: skip the network if we recently got a 401

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
