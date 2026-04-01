import React, { useState, useEffect } from 'react'
import { getToken } from '../../lib/getToken.js'

const BASE = import.meta.env.VITE_API_URL ?? ''

const CATEGORIES = ['Bug', 'Suggestion', 'Other']

export default function FeedbackModal({ appId = 'xo-arena', apiBase = '/api/v1', open, onClose }) {
  const [category, setCategory] = useState('Other')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  // Reset on open
  useEffect(() => {
    if (open) {
      setCategory('Other')
      setMessage('')
      setError(null)
      setSuccess(false)
      setLoading(false)
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!message.trim()) { setError('Please describe your feedback.'); return }
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(`${BASE}${apiBase}/feedback`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          appId,
          category: category.toUpperCase(),
          message: message.trim(),
          pageUrl: window.location.href,
          userAgent: navigator.userAgent,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Submission failed.')
      }
      setSuccess(true)
      setTimeout(() => { onClose() }, 1500)
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border shadow-2xl"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-lg leading-none p-1 rounded hover:bg-[var(--bg-surface-hover)]"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Close"
        >
          ✕
        </button>

        <div className="p-5 sm:p-6">
          <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Send Feedback</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            Found a bug or have a suggestion? We'd love to hear it.
          </p>

          {success ? (
            <div className="text-center py-6 space-y-2">
              <div className="text-3xl">✓</div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-teal-600)' }}>
                Thanks for your feedback!
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Category pills */}
              <div>
                <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Category
                </label>
                <div className="flex gap-2">
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategory(cat)}
                      className="px-3 py-1 rounded-full text-xs font-medium border transition-colors"
                      style={{
                        borderColor: category === cat ? 'var(--color-blue-500)' : 'var(--border-default)',
                        backgroundColor: category === cat ? 'var(--color-blue-50)' : 'transparent',
                        color: category === cat ? 'var(--color-blue-600)' : 'var(--text-muted)',
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Message
                </label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value.slice(0, 1000))}
                  placeholder="Describe the issue or feedback..."
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none resize-none"
                  style={{
                    backgroundColor: 'var(--bg-base)',
                    borderColor: 'var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                />
                <div className="text-right mt-0.5">
                  <span className="text-xs" style={{ color: message.length >= 900 ? 'var(--color-amber-600)' : 'var(--text-muted)' }}>
                    {message.length}/1000
                  </span>
                </div>
              </div>

              {error && (
                <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !message.trim()}
                className="w-full py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 transition-opacity"
                style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
              >
                {loading ? 'Sending…' : 'Submit Feedback'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
