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
 * No dismiss affordance — the banner persists every session until the user
 * verifies. Verification is a small ask and the consequence of forgetting
 * (silent tournament-entry rejection later) is a worse experience than a
 * mildly insistent reminder now.
 *
 * Hidden only when:
 *   - User is not signed in
 *   - User's email is verified
 */
export default function EmailVerifyBanner() {
  const { data: session } = useOptimisticSession()
  const user              = session?.user ?? null
  const [resending, setResending] = useState(false)
  const [resentOk, setResentOk]   = useState(false)
  const [error, setError]         = useState('')

  if (!user) return null
  if (user.emailVerified) return null

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

  return (
    <div
      role="status"
      aria-label="Email verification reminder"
      className="px-4 py-2 text-sm flex items-center justify-between gap-3"
      style={{
        // Slate wash that echoes the XO board cells — cool against the warm
        // colosseum hero, so the banner reads as a distinct strip rather
        // than blending into the page tint.
        backgroundColor: 'var(--color-slate-200)',
        borderBottom:    '2px solid var(--color-slate-600)',
        color:           'var(--color-slate-800)',
      }}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {/* Road-sign style warning: yellow fill with a dark border + glyph. */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 1.5L1.5 13.5h13L8 1.5z" fill="#FACC15" stroke="#1a1a1a" strokeWidth="1.2" strokeLinejoin="round"/>
          <line x1="8" y1="6.5" x2="8" y2="9.5" stroke="#1a1a1a" strokeWidth="1.4" strokeLinecap="round"/>
          <circle cx="8" cy="11.5" r="0.7" fill="#1a1a1a"/>
        </svg>
        <span className="truncate font-medium">
          {resentOk
            ? <>Verification email sent. Check your inbox.</>
            : <>Verify your email to enter tournaments. <span className="hidden sm:inline">Most of the platform works without it.</span></>
          }
        </span>
        {error && <span className="text-red-700 ml-2 truncate">— {error}</span>}
      </div>
      {!resentOk && (
        <button
          onClick={handleResend}
          disabled={resending}
          className="text-xs font-semibold underline underline-offset-2 disabled:opacity-50 flex-shrink-0"
          type="button"
        >
          {resending ? 'Sending…' : 'Resend'}
        </button>
      )}
    </div>
  )
}
