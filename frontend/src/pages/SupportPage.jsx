import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut } from '../lib/auth-client.js'
import { clearSessionCache } from '../lib/useOptimisticSession.js'
import { clearTokenCache, getToken } from '../lib/getToken.js'
import FeedbackInbox from '../components/feedback/FeedbackInbox.jsx'

const BASE = import.meta.env.VITE_API_URL ?? ''

const TABS = ['Inbox', 'User Lookup']

// ── User Lookup ────────────────────────────────────────────────────────────────

function UserLookup() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [actionError, setActionError] = useState(null)

  // Debounce
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 350)
    return () => clearTimeout(id)
  }, [query])

  useEffect(() => {
    if (!debouncedQuery.trim()) { setResults([]); return }
    let cancelled = false
    async function search() {
      setLoading(true)
      setError(null)
      try {
        const token = await getToken()
        const headers = {}
        if (token) headers['Authorization'] = `Bearer ${token}`
        const p = new URLSearchParams({ q: debouncedQuery })
        const res = await fetch(`${BASE}/api/v1/support/users?${p.toString()}`, { headers })
        if (!res.ok) throw new Error('Search failed.')
        const data = await res.json()
        if (!cancelled) setResults(data.users ?? [])
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    search()
    return () => { cancelled = true }
  }, [debouncedQuery])

  async function toggleBan(user) {
    setActionError(null)
    try {
      const token = await getToken()
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(`${BASE}/api/v1/support/users/${user.id}/ban`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ banned: !user.banned }),
      })
      if (!res.ok) throw new Error('Action failed.')
      const data = await res.json()
      setResults(prev => prev.map(u =>
        u.id === user.id ? { ...u, banned: data.user?.banned ?? !user.banned } : u
      ))
    } catch (err) {
      setActionError(err.message)
    }
  }

  function initials(name) {
    if (!name) return '?'
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  }

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search by name or email…"
        className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
          color: 'var(--text-primary)',
        }}
      />

      {actionError && (
        <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{actionError}</p>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <p className="text-sm text-center py-4" style={{ color: 'var(--color-red-600)' }}>{error}</p>
      )}

      {!loading && results.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--border-default)' }}
        >
          {results.map((user, idx) => (
            <div
              key={user.id}
              className="flex items-center gap-3 px-4 py-3"
              style={{
                borderBottom: idx < results.length - 1 ? '1px solid var(--border-default)' : 'none',
                backgroundColor: 'var(--bg-surface)',
                opacity: user.banned ? 0.6 : 1,
              }}
            >
              {/* Avatar / initials */}
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 overflow-hidden"
                style={{ backgroundColor: 'var(--color-blue-100)', color: 'var(--color-blue-700)' }}
              >
                {user.image ? (
                  <img src={user.image} alt="" className="w-full h-full object-cover" />
                ) : (
                  initials(user.displayName ?? user.name)
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {user.displayName ?? user.name ?? '—'}
                  </span>
                  {user.banned && (
                    <span
                      className="text-[10px] font-semibold px-1.5 py-px rounded-full"
                      style={{ backgroundColor: 'var(--color-red-50)', color: 'var(--color-red-600)' }}
                    >
                      banned
                    </span>
                  )}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {user.email}
                  {user.createdAt && (
                    <> · Joined {new Date(user.createdAt).toLocaleDateString()}</>
                  )}
                </div>
              </div>

              {/* Ban/Unban */}
              <button
                onClick={() => toggleBan(user)}
                className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] shrink-0"
                style={{
                  borderColor: user.banned ? 'var(--color-teal-300)' : 'var(--color-red-300)',
                  color: user.banned ? 'var(--color-teal-600)' : 'var(--color-red-600)',
                }}
              >
                {user.banned ? 'Unban' : 'Ban'}
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && debouncedQuery.trim() && results.length === 0 && !error && (
        <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>
          No users found.
        </p>
      )}
    </div>
  )
}

// ── SupportPage ───────────────────────────────────────────────────────────────

export default function SupportPage() {
  const [tab, setTab] = useState('Inbox')
  const navigate = useNavigate()

  async function handleSignOut() {
    clearSessionCache()
    clearTokenCache()
    Object.keys(sessionStorage)
      .filter(k => k.startsWith('xo_dbuser_'))
      .forEach(k => sessionStorage.removeItem(k))
    await signOut()
    navigate('/play')
  }

  return (
    <div className="min-h-dvh" style={{ backgroundColor: 'var(--bg-base)' }}>
      {/* Minimal header */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-4 sm:px-6 h-14 border-b"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-md)' }}
      >
        <div className="flex items-center gap-2">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="var(--color-blue-600)" />
            <text x="2" y="23" fontSize="19" fontWeight="800" fill="white" fontFamily="system-ui, sans-serif">X</text>
            <text x="16" y="23" fontSize="19" fontWeight="800" fill="var(--color-teal-500)" fontFamily="system-ui, sans-serif">O</text>
          </svg>
          <span className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Support</span>
        </div>
        <button
          onClick={handleSignOut}
          className="text-sm px-3 py-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-surface-hover)]"
          style={{ borderColor: 'var(--border-default)', color: 'var(--color-red-600)' }}
        >
          Sign out
        </button>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          Support
        </h1>

        {/* Tabs */}
        <div className="flex gap-2">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors"
              style={{
                borderColor: tab === t ? 'var(--color-blue-500)' : 'var(--border-default)',
                backgroundColor: tab === t ? 'var(--color-blue-50)' : 'transparent',
                color: tab === t ? 'var(--color-blue-600)' : 'var(--text-muted)',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'Inbox' && (
          <FeedbackInbox apiBase="/api/v1/support/feedback" apps={['xo-arena']} />
        )}
        {tab === 'User Lookup' && (
          <UserLookup />
        )}
      </main>
    </div>
  )
}
