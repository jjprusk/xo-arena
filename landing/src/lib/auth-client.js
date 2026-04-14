// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { createAuthClient } from 'better-auth/react'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

export const authClient = createAuthClient({
  baseURL: API_BASE
    ? `${API_BASE}/api/auth`
    : typeof window !== 'undefined'
      ? `${window.location.origin}/api/auth`
      : 'http://localhost:3000/api/auth',
  fetchOptions: {
    // Suppress console errors for 401s — expected for unauthenticated users.
    // Session state is handled by useOptimisticSession (silent custom fetch).
    onError: () => {},
  },
  sessionOptions: {
    // Disable Better Auth's background session polling — session state is
    // managed by useOptimisticSession which fetches silently on its own schedule.
    refetchInterval: 0,
    refetchOnWindowFocus: false,
  },
})

export const { useSession, signIn, signUp, signOut, forgetPassword, resetPassword, sendVerificationEmail, changePassword } = authClient
