import React, { useState, useEffect } from 'react'
import { signIn, signUp, forgetPassword, sendVerificationEmail } from '../../lib/auth-client.js'
import GoogleSignInButton from './GoogleSignInButton.jsx'
import AppleSignInButton from './AppleSignInButton.jsx'
import { api } from '../../lib/api.js'

export default function AuthModal({ isOpen, onClose, defaultView = 'sign-in' }) {
  const [view, setView] = useState(defaultView)        // 'sign-in' | 'sign-up' | 'verify-email' | 'forgot-password' | 'reset-sent'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendSent, setResendSent] = useState(false)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setView(defaultView)
      setEmail('')
      setPassword('')
      setConfirmPassword('')
      setName('')
      setError('')
      setResendSent(false)
    }
  }, [isOpen, defaultView])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  function switchView(v) {
    setView(v)
    setError('')
  }

  async function handleSignIn(e) {
    e.preventDefault()
    setError('')
    if (!email.trim()) { setError('Enter your email or username.'); return }
    if (!password) { setError('Enter your password.'); return }
    setLoading(true)
    try {
      // If input has no @, treat as username and resolve to email first
      let resolvedEmail = email.trim()
      if (!resolvedEmail.includes('@')) {
        try {
          const { email: found } = await api.users.emailByUsername(resolvedEmail.toLowerCase())
          resolvedEmail = found
        } catch {
          setError('Username not found.')
          return
        }
      }
      const result = await signIn.email({ email: resolvedEmail, password })
      if (result?.error) { setError(result.error.message || 'Sign in failed.'); return }
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

    setLoading(true)
    try {
      const displayName = name.trim() || email.split('@')[0]
      const result = await signUp.email({ email, password, name: displayName })
      if (result?.error) { setError(result.error.message || 'Sign up failed.'); return }
      setView('verify-email')
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
      await sendVerificationEmail({
        email,
        callbackURL: window.location.origin,
      })
      setResendSent(true)
      setView('verify-email')
    } catch (err) {
      setError(err?.message || 'Failed to resend verification email.')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        {/* Card — stop propagation to prevent backdrop click closing on card click */}
        <div
          className="relative w-full max-w-sm rounded-2xl border shadow-2xl"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 text-lg leading-none p-1 rounded hover:bg-[var(--bg-surface-hover)]"
            style={{ color: 'var(--text-muted)' }}
          >
            ✕
          </button>

          <div className="p-5 sm:p-8">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                {view === 'verify-email' ? 'Check your email'
                  : view === 'forgot-password' ? 'Reset password'
                  : view === 'reset-sent' ? 'Check your email'
                  : view === 'sign-in' ? 'Sign in'
                  : 'Create account'}
              </div>
              <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {view === 'verify-email' ? 'We sent you a verification link.'
                  : view === 'forgot-password' ? 'Enter your email to receive a reset link.'
                  : view === 'reset-sent' ? 'We sent you a password reset link.'
                  : 'to continue to XO Arena'}
              </div>
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
                <div className="pt-2">
                  <button
                    onClick={() => switchView('sign-in')}
                    className="text-sm underline"
                    style={{ color: 'var(--color-blue-600)' }}
                  >
                    Back to sign in
                  </button>
                </div>
              </div>
            )}

            {/* Forgot password view */}
            {view === 'forgot-password' && (
              <form onSubmit={handleForgotPassword} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Email address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoFocus
                    autoComplete="email"
                    className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                    style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                    placeholder="you@example.com"
                  />
                </div>
                {error && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 transition-opacity"
                  style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
                >
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
                <div className="text-center pt-1">
                  <button
                    type="button"
                    onClick={() => switchView('sign-in')}
                    className="text-sm underline"
                    style={{ color: 'var(--color-blue-600)' }}
                  >
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
                  Click the link in the email to choose a new password.
                </p>
                <div className="pt-2">
                  <button
                    onClick={() => switchView('sign-in')}
                    className="text-sm underline"
                    style={{ color: 'var(--color-blue-600)' }}
                  >
                    Back to sign in
                  </button>
                </div>
              </div>
            )}

            {/* Sign-in / Sign-up views */}
            {view !== 'verify-email' && view !== 'forgot-password' && view !== 'reset-sent' && (
              <>
                {/* Tab row */}
                <div className="flex rounded-lg mb-6 p-0.5" style={{ backgroundColor: 'var(--bg-base)' }}>
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

                {/* Social sign-in */}
                <div className="space-y-2 mb-4">
                  <GoogleSignInButton />
                  <AppleSignInButton />
                </div>

                {/* Divider */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-default)' }} />
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>or</span>
                  <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-default)' }} />
                </div>

                {/* Sign-in form */}
                {view === 'sign-in' && (
                  <form onSubmit={handleSignIn} className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Email or username
                      </label>
                      <input
                        type="text"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        autoFocus
                        autoComplete="email"
                        className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2"
                        style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--color-blue-600)' }}
                        placeholder="you@example.com or username"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Password
                      </label>
                      <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        autoComplete="current-password"
                        className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                        style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                        placeholder="••••••••"
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

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 transition-opacity"
                      style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
                    >
                      {loading ? 'Please wait…' : 'Sign in'}
                    </button>
                  </form>
                )}

                {/* Sign-up form */}
                {view === 'sign-up' && (
                  <form onSubmit={handleSignUp} className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Display name
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        autoFocus
                        autoComplete="name"
                        className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                        style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                        placeholder="Your name"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Email address
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        autoComplete="email"
                        className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                        style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                        placeholder="you@example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Password
                      </label>
                      <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        autoComplete="new-password"
                        className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                        style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                        placeholder="Min. 8 characters"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Confirm password
                      </label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        autoComplete="new-password"
                        className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                        style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                        placeholder="••••••••"
                      />
                    </div>

                    {error && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>}

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 transition-opacity"
                      style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
                    >
                      {loading ? 'Creating account…' : 'Create account'}
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
