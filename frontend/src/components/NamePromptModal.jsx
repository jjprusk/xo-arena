import React, { useState, useEffect } from 'react'
import { api } from '../lib/api.js'
import { getToken } from '../lib/getToken.js'
import Modal from './ui/Modal.jsx'

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

  return (
    <Modal isOpen={isOpen} onClose={onSkip}>
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
            className="form-input"
            placeholder="Your display name"
          />

          {error && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary flex-1"
            >
              {loading ? 'Saving…' : 'Save name'}
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="btn btn-ghost px-4"
            >
              Skip
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
