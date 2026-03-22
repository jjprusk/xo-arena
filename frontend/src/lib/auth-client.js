import { createAuthClient } from 'better-auth/react'

// Better Auth requires an absolute URL. In the browser we use window.location.origin
// so it works on any host/port without hardcoding localhost.
export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined'
    ? `${window.location.origin}/api/auth`
    : 'http://localhost:3000/api/auth',
})

export const { useSession, signIn, signUp, signOut } = authClient
