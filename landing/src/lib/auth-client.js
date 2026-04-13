// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { createAuthClient } from 'better-auth/react'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

export const authClient = createAuthClient({
  baseURL: API_BASE
    ? `${API_BASE}/api/auth`
    : typeof window !== 'undefined'
      ? `${window.location.origin}/api/auth`
      : 'http://localhost:3000/api/auth',
})

export const { useSession, signIn, signUp, signOut, forgetPassword, resetPassword, sendVerificationEmail } = authClient
