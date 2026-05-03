import { createAuthClient as createBetterAuthClient } from 'better-auth/react'

/**
 * Creates a Better Auth client configured for the XO Arena platform family.
 *
 * URL resolution order:
 *   1. Explicit `baseURL` argument (e.g. 'https://api.example.com/api/auth')
 *   2. VITE_API_URL env var + '/api/auth'  (Railway / production)
 *   3. window.location.origin + '/api/auth' (browser dev — works via Vite proxy)
 *   4. 'http://localhost:3000/api/auth'     (SSR / test fallback)
 *
 * @param {string} [baseURL] - Optional explicit auth base URL.
 * @returns {import('better-auth/react').AuthClient}
 */
export function createAuthClient(baseURL) {
  const resolved = baseURL
    ?? (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL
        ? `${import.meta.env.VITE_API_URL}/api/auth`
        : null)
    ?? (typeof window !== 'undefined'
        ? `${window.location.origin}/api/auth`
        : 'http://localhost:3000/api/auth')

  return createBetterAuthClient({ baseURL: resolved })
}
