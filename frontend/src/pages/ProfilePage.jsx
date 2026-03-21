import React, { useEffect, useState } from 'react'
import { useSession } from '../lib/auth-client.js'
import { getToken } from '../lib/getToken.js'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'

export default function ProfilePage() {
  const { data: session, isPending } = useSession()
  const isLoaded = !isPending
  const isSignedIn = !!session?.user
  const clerkUser = session?.user ?? null
  const [dbUser, setDbUser] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Display name editing
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) return

    setLoading(true)
    async function load() {
      try {
        const token = await getToken()
        const { user } = await api.users.sync(token)
        setDbUser(user)
        setNameInput(user.displayName)
        const { stats: s } = await api.users.stats(user.id)
        setStats(s)
      } catch {
        setError('Failed to load profile.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [isSignedIn, isLoaded])

  async function handleSaveName() {
    if (!nameInput.trim() || nameInput === dbUser.displayName) {
      setEditing(false)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const token = await getToken()
      const { user: updated } = await api.patch(`/users/${dbUser.id}`, { displayName: nameInput.trim() }, token)
      setDbUser(updated)
      setEditing(false)
    } catch {
      setSaveError('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!isLoaded || loading) {
    return (
      <div className="max-w-lg mx-auto flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!isSignedIn) {
    return (
      <div className="max-w-lg mx-auto space-y-8">
        <PageHeader title="Profile" />
        <div
          className="rounded-xl border p-8 text-center"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
        >
          <p className="text-lg font-semibold mb-2">Sign in to view your profile</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Your account details and game history are available once you sign in.
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto space-y-8">
        <PageHeader title="Profile" />
        <p className="text-sm text-center" style={{ color: 'var(--color-red-600)' }}>{error}</p>
      </div>
    )
  }

  if (!dbUser) return null

  const memberSince = new Date(dbUser.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const initial = (dbUser.displayName?.[0] || '?').toUpperCase()

  return (
    <div className="max-w-lg mx-auto space-y-8">
      <PageHeader title="Profile" />

      {/* Identity card */}
      <div
        className="rounded-xl border p-6 space-y-5"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
      >
        {/* Avatar + name row */}
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0 overflow-hidden"
            style={{ backgroundColor: 'var(--color-blue-100)', color: 'var(--color-blue-700)' }}
          >
            {clerkUser?.image
              ? <img src={clerkUser.image} alt={dbUser.displayName} className="w-full h-full object-cover" />
              : initial}
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-2">
                <input
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditing(false) }}
                  maxLength={40}
                  className="w-full px-3 py-1.5 rounded-lg border text-sm font-semibold outline-none focus:border-[var(--color-blue-600)] transition-colors"
                  style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveName}
                    disabled={saving || !nameInput.trim()}
                    className="px-3 py-1 text-xs font-semibold rounded-lg transition-all hover:brightness-110 disabled:opacity-50"
                    style={{ backgroundColor: 'var(--color-blue-600)', color: 'white' }}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setEditing(false); setNameInput(dbUser.displayName) }}
                    className="px-3 py-1 text-xs font-medium rounded-lg transition-colors"
                    style={{ backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-secondary)' }}
                  >
                    Cancel
                  </button>
                </div>
                {saveError && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{saveError}</p>}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold truncate">{dbUser.displayName}</span>
                <button
                  onClick={() => setEditing(true)}
                  className="text-xs px-2 py-0.5 rounded-md transition-colors flex-shrink-0"
                  style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface-hover)' }}
                  title="Edit display name"
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="h-px" style={{ backgroundColor: 'var(--border-default)' }} />

        {/* Details */}
        <dl className="space-y-3">
          <Row label="Email" value={dbUser.email || clerkUser?.email || '—'} />
          <Row label="Sign-in method" value={dbUser.oauthProvider ? capitalize(dbUser.oauthProvider) : 'Email'} />
          <Row label="Member since" value={memberSince} />
        </dl>
      </div>

      {/* Quick stats */}
      {stats && stats.totalGames > 0 && (
        <section className="space-y-3">
          <SectionLabel>Quick Stats</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Games" value={stats.totalGames} />
            <StatCard label="Wins" value={stats.wins} color="var(--color-teal-600)" />
            <StatCard label="Win Rate" value={`${Math.round(stats.winRate * 100)}%`} color="var(--color-teal-600)" />
          </div>
          <Link
            to="/stats"
            className="text-sm font-medium transition-colors"
            style={{ color: 'var(--color-blue-600)' }}
          >
            View full stats →
          </Link>
        </section>
      )}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-sm" style={{ color: 'var(--text-muted)' }}>{label}</dt>
      <dd className="text-sm font-medium text-right truncate" style={{ color: 'var(--text-primary)' }}>{value}</dd>
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div
      className="rounded-xl border p-4 text-center"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: color || 'var(--text-primary)' }}>
        {value}
      </div>
      <div className="text-xs mt-1 font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

function PageHeader({ title }) {
  return (
    <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
      <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>{title}</h1>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
      {children}
    </h2>
  )
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
