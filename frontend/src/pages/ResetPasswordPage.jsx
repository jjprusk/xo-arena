// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { resetPassword } from '../lib/auth-client.js'

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const token = searchParams.get('token')

  useEffect(() => {
    if (!token) {
      setError('Invalid or missing reset token. Please request a new reset link.')
    }
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!password || password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    if (!token) { setError('Invalid reset token.'); return }

    setLoading(true)
    try {
      const result = await resetPassword({ newPassword: password, token })
      if (result?.error) { setError(result.error.message || 'Reset failed.'); return }
      setDone(true)
      setTimeout(() => navigate('/play'), 3000)
    } catch (err) {
      setError(err?.message || 'Reset failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--bg-base)' }}>
      <div
        className="w-full max-w-sm rounded-2xl border shadow-2xl p-8"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
      >
        <div className="text-center mb-6">
          <div className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            {done ? 'Password updated' : 'Choose a new password'}
          </div>
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {done ? 'Redirecting you to the app…' : 'for your XO Arena account'}
          </div>
        </div>

        {done ? (
          <div className="text-center text-4xl">✅</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                New password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus
                autoComplete="new-password"
                className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                placeholder="Min. 8 characters"
                disabled={!token}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                Confirm new password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                placeholder="••••••••"
                disabled={!token}
              />
            </div>

            {error && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>}

            <button
              type="submit"
              disabled={loading || !token}
              className="w-full py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 transition-opacity"
              style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
            >
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
