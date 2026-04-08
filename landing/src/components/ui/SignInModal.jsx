import React, { useState } from 'react'
import { signIn } from '../../lib/auth-client.js'

export default function SignInModal({ onClose }) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState(null)
  const [busy, setBusy]         = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await signIn.email({ email, password })
      if (res.error) throw new Error(res.error.message || 'Sign in failed')
      onClose()
    } catch (err) {
      setError(err.message || 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}
      >
        <div>
          <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            Sign in to AI Arena
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            One account across all games and tournaments.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
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
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="input"
            required
          />
          {error && <p className="text-xs" style={{ color: 'var(--color-red-500)' }}>{error}</p>}
          <button type="submit" disabled={busy} className="btn btn-primary w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <button
          onClick={onClose}
          className="btn btn-ghost btn-sm w-full"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
