import { createAuthClient } from 'better-auth/react'

// Better Auth requires an absolute URL. In the browser we use window.location.origin
// so it works on any host/port without hardcoding localhost.
// In production VITE_API_URL points to the Cloud Run backend directly.
// In local dev it is empty, so we fall back to window.location.origin (same host via Vite proxy).
const API_BASE = import.meta.env.VITE_API_URL ?? ''

export const authClient = createAuthClient({
  baseURL: API_BASE
    ? `${API_BASE}/api/auth`
    : typeof window !== 'undefined'
      ? `${window.location.origin}/api/auth`
      : 'http://localhost:3000/api/auth',
})

export const { useSession, signIn, signUp, signOut } = authClient
