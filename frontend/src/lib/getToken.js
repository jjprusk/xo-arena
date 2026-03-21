/**
 * Returns a signed JWT bearer token from the Better Auth JWT plugin endpoint.
 * Works in both React components and non-React contexts (Zustand, etc.).
 */
export async function getToken() {
  try {
    const res = await fetch('/api/auth/token', { method: 'GET', credentials: 'include' })
    if (!res.ok) return null
    const data = await res.json()
    return data?.token ?? null
  } catch {
    return null
  }
}
