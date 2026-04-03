import React, { useState, useEffect } from 'react'
import { api } from '../lib/api.js'
import { getToken } from '../lib/getToken.js'

export default function NamePromptModal({ isOpen, userId, currentName, onSave, onSkip }) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) {
      setName(currentName || '')
      setError('')
    }
  }, [isOpen, currentName])

  useEffect(() => {
    if (!isOpen) return
    function onKey(e) { if (e.key === 'Escape') onSkip() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onSkip])

  async function handleSave(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('Please enter a name.'); return }
    setLoading(true)
    setError('')
    try {
      const token = await getToken()
      const { user } = await api.patch(`/users/${userId}`, { displayName: trimmed }, token)
      onSave(user)
    } catch (err) {
      setError(err?.message || 'Failed to save name.')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={onSkip}
    >
      <div
        className="w-full max-w-sm rounded-2xl border shadow-xl overflow-hidden"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="px-6 py-5">
          <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
            What should we call you?
          </h2>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            Your account was created with an auto-generated name. Set one you'll recognize on the leaderboard.
          </p>

          <form onSubmit={handleSave} className="space-y-3">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              autoComplete="name"
              maxLength={40}
              className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2"
              style={{
                backgroundColor: 'var(--bg-base)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
                '--tw-ring-color': 'var(--color-blue-600)',
              }}
              placeholder="Your display name"
            />

            {error && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>}

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 transition-opacity"
                style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
              >
                {loading ? 'Saving…' : 'Save name'}
              </button>
              <button
                type="button"
                onClick={onSkip}
                className="px-4 py-2 rounded-lg text-sm hover:bg-[var(--bg-surface-hover)] transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                Skip
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
