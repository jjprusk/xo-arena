// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState } from 'react'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import { sendVerificationEmail } from '../../lib/auth-client.js'

/**
 * Email verification soft banner — Phase 0 (Intelligent Guide v1, §3.5.4).
 *
 * Shown across the top of the app for any authenticated user whose email
 * is not yet verified. NON-BLOCKING — the user can use most of the platform
 * (play, create bots, train, spar, browse). Only tournament entry is gated
 * (returns 403 EMAIL_VERIFICATION_REQUIRED at the API layer).
 *
 * The banner gives the user a "Resend verification email" affordance so
 * they can verify when they want to compete, without being walled out from
 * exploration in the meantime.
 *
 * Hidden when:
 *   - User is not signed in
 *   - User's email is verified
 *   - User has dismissed the banner this session (transient sessionStorage flag)
 */
export default function EmailVerifyBanner() {
  const { data: session } = useOptimisticSession()
  const user              = session?.user ?? null
  const [resending, setResending] = useState(false)
  const [resentOk, setResentOk]   = useState(false)
  const [error, setError]         = useState('')
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined' || !window.sessionStorage) return false
    return window.sessionStorage.getItem('emailVerifyBannerDismissed') === '1'
  })

  // Hidden states
  if (!user) return null
  if (user.emailVerified) return null
  if (dismissed) return null

  async function handleResend() {
    setError('')
    setResending(true)
    try {
      await sendVerificationEmail({ email: user.email, callbackURL: window.location.origin })
      setResentOk(true)
    } catch (err) {
      setError(err?.message || 'Failed to resend verification email.')
    } finally {
      setResending(false)
    }
  }

  function handleDismiss() {
    setDismissed(true)
    try { window.sessionStorage.setItem('emailVerifyBannerDismissed', '1') } catch { /* non-fatal */ }
  }

  return (
    <div
      role="status"
      aria-label="Email verification reminder"
      className="px-4 py-2 text-sm flex items-center justify-between gap-3"
      style={{
        backgroundColor: 'var(--color-amber-50, #fff8e6)',
        borderBottom:    '1px solid var(--color-amber-200, #fde68a)',
        color:           'var(--color-amber-900, #78350f)',
      }}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 1.5L1.5 13.5h13L8 1.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
          <line x1="8" y1="6.5" x2="8" y2="9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          <circle cx="8" cy="11.5" r="0.65" fill="currentColor"/>
        </svg>
        <span className="truncate">
          {resentOk
            ? <>Verification email sent. Check your inbox.</>
            : <>Verify your email to enter tournaments. <span className="hidden sm:inline">Most of the platform works without it.</span></>
          }
        </span>
        {error && <span className="text-red-700 ml-2 truncate">— {error}</span>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {!resentOk && (
          <button
            onClick={handleResend}
            disabled={resending}
            className="text-xs font-semibold underline underline-offset-2 disabled:opacity-50"
            type="button"
          >
            {resending ? 'Sending…' : 'Resend'}
          </button>
        )}
        <button
          onClick={handleDismiss}
          className="text-xs opacity-60 hover:opacity-100"
          aria-label="Dismiss for this session"
          type="button"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
