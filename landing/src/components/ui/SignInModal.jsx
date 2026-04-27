// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect, useRef } from 'react'
import { signIn, signUp, forgetPassword, sendVerificationEmail } from '../../lib/auth-client.js'
import { triggerSessionRefresh } from '../../lib/useOptimisticSession.js'
import { clearTokenCache, getToken } from '../../lib/getToken.js'
import { api } from '../../lib/api.js'
import { readGuestJourney, hasGuestProgress, clearGuestJourney } from '../../lib/guestMode.js'
import GoogleSignInButton from './GoogleSignInButton.jsx'
import AppleSignInButton from './AppleSignInButton.jsx'

/**
 * SignInModal — sign-in, sign-up, password recovery, and (legacy) verify-email.
 *
 * Phase 0 changes (Intelligent Guide v1, §3.5.4):
 *   - On successful signup, the modal closes immediately and the user is
 *     signed in — no more "verify-email" wall. A soft banner across the top
 *     of the app (EmailVerifyBanner) prompts verification later. Tournament
 *     entry remains the only feature blocked behind verified email
 *     (enforced at the API layer with EMAIL_VERIFICATION_REQUIRED).
 *   - On successful signup, any guest-mode Hook progress in localStorage is
 *     posted to /api/v1/guide/guest-credit so the new user starts in
 *     Curriculum step 3 with Hook 1+2 already credited.
 *   - The optional `context` prop adjusts the modal's copy:
 *       'build-bot' → "Build your first bot — create a free account"
 *       (any other) → standard sign-in / sign-up
 *   - The optional `onSuccess` callback fires after a successful sign-in or
 *     sign-up (before `onClose`) so callers can run post-auth navigation —
 *     e.g. PlayPage routes the user to `/` so the post-signup landing matches
 *     the V1 acceptance flow instead of leaving them stuck mid-PvAI.
 */
export default function SignInModal({ onClose, onSuccess, defaultView = 'sign-in', context = null }) {
  const [view, setView]                   = useState(defaultView)  // 'sign-in' | 'sign-up' | 'verify-email' | 'forgot-password' | 'reset-sent'
  const [email, setEmail]                 = useState('')
  const [password, setPassword]           = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName]                   = useState('')
  const [error, setError]                 = useState('')
  const [loading, setLoading]             = useState(false)
  const [resendSent, setResendSent]       = useState(false)
  const [honeypot, setHoneypot]           = useState('')
  const formStartedAt                     = useRef(null)

  useEffect(() => {
    setView(defaultView)
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setName('')
    setError('')
    setResendSent(false)
    setHoneypot('')
    if (defaultView === 'sign-up') formStartedAt.current = Date.now()
  }, [defaultView])

  function switchView(v) {
    setView(v)
    setError('')
    if (v === 'sign-up') formStartedAt.current = Date.now()
  }

  async function handleSignIn(e) {
    e.preventDefault()
    setError('')
    if (!email.trim()) { setError('Enter your email.'); return }
    if (!password) { setError('Enter your password.'); return }
    setLoading(true)
    try {
      const result = await signIn.email({ email: email.trim(), password })
      if (result?.error) { setError(result.error.message || 'Sign in failed.'); return }
      // Wipe any _nullUntil set during the guest-browse interval so the next
      // getToken() hits /api/token fresh. Without this, token-gated actions
      // (delete table, etc.) see a cached null for up to 30s after sign-in,
      // even though the session is already live.
      clearTokenCache()
      triggerSessionRefresh()
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(err?.message || 'Sign in failed.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSignUp(e) {
    e.preventDefault()
    setError('')
    if (!email || !email.includes('@')) { setError('Enter a valid email address.'); return }
    if (!password || password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }

    // Honeypot: silently redirect without revealing the check
    if (honeypot) { setView('verify-email'); return }

    // Timing: bot submissions arrive too fast
    if (formStartedAt.current && Date.now() - formStartedAt.current < 3000) {
      setError('Please wait a moment before submitting.')
      return
    }

    setLoading(true)
    try {
      const displayName = name.trim() || email.split('@')[0]
      const result = await signUp.email({
        email, password, name: displayName,
        callbackURL: window.location.origin,
        fetchOptions: {
          headers: {
            'x-hp':  honeypot,
            'x-fst': String(formStartedAt.current ?? 0),
          },
        },
      })
      if (result?.error) { setError(result.error.message || 'Sign up failed.'); return }
      if (result?.user?.emailVerified) {
        setError('An account with this email already exists. Please sign in.')
        switchView('sign-in')
        return
      }

      // Phase 0: signup no longer blocks on email verification. Tournament
      // entry is the gated action (server returns 403 EMAIL_VERIFICATION_
      // REQUIRED until verified). Sign the user in immediately and credit
      // any guest-mode Hook progress they accumulated pre-signup.
      clearTokenCache()
      // Guest-credit is non-essential — fire and forget so a slow or hung
      // /guide/guest-credit can't block the modal close + post-auth navigation.
      // If it fails the user just loses the Hook pre-credit (recoverable from
      // server-side step detection on first journey check).
      if (hasGuestProgress()) {
        ;(async () => {
          try {
            const token = await getToken()
            if (!token) return
            const journey = readGuestJourney()
            await api.guide.guestCredit(journey, token)
            clearGuestJourney()
          } catch { /* non-fatal */ }
        })()
      }
      triggerSessionRefresh()
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(err?.message || 'Sign up failed.')
    } finally {
      setLoading(false)
    }
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    setError('')
    if (!email || !email.includes('@')) { setError('Enter a valid email address.'); return }
    setLoading(true)
    try {
      const redirectTo = `${window.location.origin}/reset-password`
      await forgetPassword({ email, redirectTo })
      setView('reset-sent')
    } catch (err) {
      setError(err?.message || 'Failed to send reset email.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResendVerification() {
    setError('')
    setLoading(true)
    try {
      await sendVerificationEmail({ email, callbackURL: window.location.origin })
      setResendSent(true)
    } catch (err) {
      setError(err?.message || 'Failed to resend verification email.')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    backgroundColor: 'var(--bg-base)',
    borderColor: 'var(--border-default)',
    color: 'var(--text-primary)',
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl p-6 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-lg leading-none p-1 rounded hover:opacity-70"
          style={{ color: 'var(--text-muted)' }}
        >
          ✕
        </button>

        {/* Header */}
        <div className="text-center">
          <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            {view === 'verify-email' ? 'Check your email'
              : view === 'forgot-password' ? 'Reset password'
              : view === 'reset-sent' ? 'Check your email'
              : view === 'sign-in' ? 'Sign in to AI Arena'
              : context === 'build-bot' ? 'Build your first bot'
              : 'Create your account'}
          </h2>
          {(view === 'sign-in' || view === 'sign-up') && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {view === 'sign-up' && context === 'build-bot'
                ? 'Free account. Your bot competes in tournaments against bots built by other players.'
                : 'One account across all games and tournaments.'}
            </p>
          )}
        </div>

        {/* Verify email view */}
        {view === 'verify-email' && (
          <div className="text-center space-y-4">
            <div className="text-4xl">📬</div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              A verification email was sent to <strong>{email}</strong>.
              Click the link in the email to activate your account.
            </p>
            {resendSent ? (
              <p className="text-sm font-medium" style={{ color: 'var(--color-green-600, #16a34a)' }}>
                ✓ Email sent — check your inbox
              </p>
            ) : (
              <button
                onClick={handleResendVerification}
                disabled={loading}
                className="text-sm underline disabled:opacity-60"
                style={{ color: 'var(--color-blue-600)' }}
              >
                {loading ? 'Sending…' : 'Resend verification email'}
              </button>
            )}
            <div>
              <button onClick={() => switchView('sign-in')} className="text-sm underline" style={{ color: 'var(--color-blue-600)' }}>
                Back to sign in
              </button>
            </div>
          </div>
        )}

        {/* Forgot password view */}
        {view === 'forgot-password' && (
          <form onSubmit={handleForgotPassword} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoFocus
              autoComplete="email"
              className="input"
              placeholder="you@example.com"
            />
            {error && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>}
            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
            <div className="text-center">
              <button type="button" onClick={() => switchView('sign-in')} className="text-sm underline" style={{ color: 'var(--color-blue-600)' }}>
                Back to sign in
              </button>
            </div>
          </form>
        )}

        {/* Reset sent view */}
        {view === 'reset-sent' && (
          <div className="text-center space-y-4">
            <div className="text-4xl">📬</div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              A password reset link was sent to <strong>{email}</strong>.
            </p>
            <button onClick={() => switchView('sign-in')} className="text-sm underline" style={{ color: 'var(--color-blue-600)' }}>
              Back to sign in
            </button>
          </div>
        )}

        {/* Sign-in / Sign-up views */}
        {(view === 'sign-in' || view === 'sign-up') && (
          <>
            {/* Tab row */}
            <div className="flex rounded-lg p-0.5" style={{ backgroundColor: 'var(--bg-base)' }}>
              {['sign-in', 'sign-up'].map(v => (
                <button
                  key={v}
                  onClick={() => switchView(v)}
                  className="flex-1 py-1.5 rounded-md text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: view === v ? 'var(--bg-surface)' : 'transparent',
                    color: view === v ? 'var(--text-primary)' : 'var(--text-muted)',
                    boxShadow: view === v ? 'var(--shadow-card)' : 'none',
                  }}
                >
                  {v === 'sign-in' ? 'Sign in' : 'Sign up'}
                </button>
              ))}
            </div>

            {/* Social buttons */}
            <div className="space-y-2">
              <GoogleSignInButton callbackURL="/" />
              <AppleSignInButton callbackURL="/" />
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <hr style={{ flex: 1, borderColor: 'var(--border-default)' }} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>or</span>
              <hr style={{ flex: 1, borderColor: 'var(--border-default)' }} />
            </div>

            {/* Sign-in form */}
            {view === 'sign-in' && (
              <form onSubmit={handleSignIn} className="space-y-3">
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="Email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoFocus
                  className="input"
                  required
                />
                <div>
                  <input
                    type="password"
                    autoComplete="current-password"
                    placeholder="Password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="input"
                    required
                  />
                  <div className="text-right mt-1">
                    <button
                      type="button"
                      onClick={() => switchView('forgot-password')}
                      className="text-xs"
                      style={{ color: 'var(--color-blue-600)' }}
                    >
                      Forgot password?
                    </button>
                  </div>
                </div>
                {error && (
                  <div>
                    <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>
                    {error.toLowerCase().includes('verif') && (
                      resendSent ? (
                        <p className="text-xs mt-1 font-medium" style={{ color: 'var(--color-green-600, #16a34a)' }}>
                          ✓ Email sent — check your inbox
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={handleResendVerification}
                          disabled={loading}
                          className="text-xs underline mt-1 disabled:opacity-60"
                          style={{ color: 'var(--color-blue-600)' }}
                        >
                          {loading ? 'Sending…' : 'Resend verification email'}
                        </button>
                      )
                    )}
                  </div>
                )}
                <button type="submit" disabled={loading} className="btn btn-primary w-full">
                  {loading ? 'Please wait…' : 'Sign in'}
                </button>
              </form>
            )}

            {/* Sign-up form */}
            {view === 'sign-up' && (
              <form onSubmit={handleSignUp} className="space-y-3">
                <input
                  type="text"
                  autoComplete="name"
                  placeholder="Display name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoFocus
                  className="input"
                />
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="Email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="input"
                  required
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Password (min. 8 characters)"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="input"
                  required
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="input"
                  required
                />

                {/* Honeypot */}
                <input
                  type="text"
                  value={honeypot}
                  onChange={e => setHoneypot(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden', opacity: 0 }}
                />

                {error && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>}
                <button type="submit" disabled={loading} className="btn btn-primary w-full">
                  {loading ? 'Creating account…' : 'Create account'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  )
}
