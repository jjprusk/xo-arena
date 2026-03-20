import React, { useEffect, useState, useCallback } from 'react'
import { useUser } from '@clerk/clerk-react'
import { api } from '../../lib/api.js'
import { AdminHeader, Spinner, ErrorMsg } from './AdminDashboard.jsx'

async function getToken() {
  return window.Clerk?.session?.getToken() ?? null
}

export default function AdminUsersPage() {
  const { user: currentUser } = useUser()
  const [users, setUsers]     = useState([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [search, setSearch]   = useState('')
  const [query, setQuery]     = useState('')   // committed search
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [editingElo, setEditingElo]         = useState(null) // { id, value }
  const [editingModelLimit, setEditingModelLimit] = useState(null) // { id, value }
  const [actionError, setActionError]       = useState(null)

  const LIMIT = 25
  const totalPages = Math.ceil(total / LIMIT)

  const load = useCallback(async (q, p) => {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const { users: u, total: t } = await api.admin.users(token, q, p, LIMIT)
      setUsers(u)
      setTotal(t)
    } catch {
      setError('Failed to load users.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(query, page) }, [query, page, load])

  function handleSearch(e) {
    e.preventDefault()
    setPage(1)
    setQuery(search)
  }

  async function toggleBan(user) {
    setActionError(null)
    try {
      const token = await getToken()
      const updated = await api.admin.updateUser(user.id, { banned: !user.banned }, token)
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, banned: updated.user.banned } : u))
    } catch {
      setActionError('Action failed. Try again.')
    }
  }

  async function saveElo(id) {
    const val = parseFloat(editingElo.value)
    if (isNaN(val)) { setEditingElo(null); return }
    setActionError(null)
    try {
      const token = await getToken()
      const updated = await api.admin.updateUser(id, { eloRating: val }, token)
      setUsers(prev => prev.map(u => u.id === id ? { ...u, eloRating: updated.user.eloRating } : u))
    } catch {
      setActionError('ELO update failed.')
    } finally {
      setEditingElo(null)
    }
  }

  async function saveModelLimit(id) {
    const raw = editingModelLimit.value.trim()
    // Empty string means reset to default (null)
    const val = raw === '' ? null : parseInt(raw)
    if (val !== null && isNaN(val)) { setEditingModelLimit(null); return }
    setActionError(null)
    try {
      const token = await getToken()
      const updated = await api.admin.updateUser(id, { mlModelLimit: val }, token)
      setUsers(prev => prev.map(u => u.id === id ? { ...u, mlModelLimit: updated.user.mlModelLimit } : u))
    } catch {
      setActionError('Model limit update failed.')
    } finally {
      setEditingModelLimit(null)
    }
  }

  async function deleteUser(user) {
    if (!confirm(`Delete ${user.displayName}? This cannot be undone.`)) return
    setActionError(null)
    try {
      const token = await getToken()
      await api.admin.deleteUser(user.id, token)
      setUsers(prev => prev.filter(u => u.id !== user.id))
      setTotal(t => t - 1)
    } catch {
      setActionError('Delete failed.')
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <AdminHeader title="Users" subtitle={`${total} total`} />

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, email or username…"
          className="flex-1 px-3 py-2 rounded-lg border text-sm focus:outline-none"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
        >
          Search
        </button>
        {query && (
          <button type="button" onClick={() => { setSearch(''); setQuery(''); setPage(1) }}
            className="px-3 py-2 rounded-lg text-sm border hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            Clear
          </button>
        )}
      </form>

      {actionError && <ErrorMsg>{actionError}</ErrorMsg>}
      {loading && <Spinner />}
      {error && <ErrorMsg>{error}</ErrorMsg>}

      {!loading && users.length > 0 && (
        <div className="rounded-xl border overflow-x-auto overflow-y-auto max-h-[60vh]" style={{ borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)' }}>
                <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>User</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wide hidden sm:table-cell" style={{ color: 'var(--text-muted)' }}>Email</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>ELO</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wide hidden md:table-cell" style={{ color: 'var(--text-muted)' }}>Games</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wide hidden md:table-cell" style={{ color: 'var(--text-muted)' }}>Model Limit</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr
                  key={u.id}
                  style={{
                    backgroundColor: i % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-base)',
                    borderBottom: '1px solid var(--border-default)',
                    opacity: u.banned ? 0.6 : 1,
                  }}
                >
                  {/* Name */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center overflow-hidden text-xs font-bold"
                        style={{ backgroundColor: 'white', border: '1px solid var(--color-blue-200)', color: 'var(--color-blue-600)' }}
                      >
                        {u.avatarUrl
                          ? <img src={u.avatarUrl} alt="" className="w-full h-full object-cover" />
                          : u.displayName?.[0]?.toUpperCase()
                        }
                      </div>
                      <div>
                        <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{u.displayName}</div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>@{u.username}</div>
                      </div>
                    </div>
                  </td>

                  {/* Email */}
                  <td className="px-4 py-3 hidden sm:table-cell max-w-[180px]" style={{ color: 'var(--text-secondary)' }}>
                    <span className="block truncate">{u.email}</span>
                  </td>

                  {/* ELO (inline edit) */}
                  <td className="px-4 py-3 text-right">
                    {editingElo?.id === u.id ? (
                      <div className="flex items-center gap-1 justify-end">
                        <input
                          type="number"
                          value={editingElo.value}
                          onChange={e => setEditingElo({ id: u.id, value: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter') saveElo(u.id); if (e.key === 'Escape') setEditingElo(null) }}
                          className="w-20 px-2 py-0.5 rounded border text-sm text-right focus:outline-none"
                          style={{ borderColor: 'var(--color-blue-400)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                          autoFocus
                        />
                        <button onClick={() => saveElo(u.id)} className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-teal-100)', color: 'var(--color-teal-700)' }}>✓</button>
                        <button onClick={() => setEditingElo(null)} className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-gray-100)', color: 'var(--text-muted)' }}>✕</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingElo({ id: u.id, value: Math.round(u.eloRating) })}
                        className="font-mono font-semibold hover:underline"
                        style={{ color: 'var(--color-blue-600)' }}
                        title="Click to edit ELO"
                      >
                        {Math.round(u.eloRating)}
                      </button>
                    )}
                  </td>

                  {/* Games */}
                  <td className="px-4 py-3 text-right hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>
                    {u._count.gamesAsPlayer1}
                  </td>

                  {/* Model Limit */}
                  <td className="px-4 py-3 text-right hidden md:table-cell">
                    {editingModelLimit?.id === u.id ? (
                      <div className="flex items-center gap-1 justify-end">
                        <input
                          type="number"
                          min="0"
                          placeholder="default"
                          value={editingModelLimit.value}
                          onChange={e => setEditingModelLimit({ id: u.id, value: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter') saveModelLimit(u.id); if (e.key === 'Escape') setEditingModelLimit(null) }}
                          className="w-20 px-2 py-0.5 rounded border text-sm text-right focus:outline-none"
                          style={{ borderColor: 'var(--color-blue-400)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                          autoFocus
                        />
                        <button onClick={() => saveModelLimit(u.id)} className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-teal-100)', color: 'var(--color-teal-700)' }}>✓</button>
                        <button onClick={() => setEditingModelLimit(null)} className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-gray-100)', color: 'var(--text-muted)' }}>✕</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingModelLimit({ id: u.id, value: u.mlModelLimit ?? '' })}
                        className="font-mono hover:underline"
                        style={{ color: u.mlModelLimit !== null ? 'var(--color-blue-600)' : 'var(--text-muted)' }}
                        title="Click to set a custom limit. Leave blank to use the default."
                      >
                        {u.mlModelLimit !== null ? u.mlModelLimit : 'default'}
                      </button>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 text-center">
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: u.banned ? 'var(--color-red-50)' : 'var(--color-teal-50)',
                        color: u.banned ? 'var(--color-red-600)' : 'var(--color-teal-600)',
                      }}
                    >
                      {u.banned ? 'Banned' : 'Active'}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    {(() => {
                      const isSelf = u.clerkId === currentUser?.id
                      return (
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => !isSelf && toggleBan(u)}
                        disabled={isSelf}
                        className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{
                          borderColor: u.banned ? 'var(--color-teal-400)' : 'var(--color-red-400)',
                          color: u.banned ? 'var(--color-teal-600)' : 'var(--color-red-600)',
                        }}
                        title={isSelf ? 'Cannot ban yourself' : undefined}
                      >
                        {u.banned ? 'Unban' : 'Ban'}
                      </button>
                      <button
                        onClick={() => !isSelf && deleteUser(u)}
                        disabled={isSelf}
                        className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--color-red-50)] disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
                        title={isSelf ? 'Cannot delete yourself' : 'Delete user'}
                      >
                        ✕
                      </button>
                    </div>
                      )
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && users.length === 0 && !error && (
        <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>No users found.</p>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 rounded border text-sm disabled:opacity-40 hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            ← Prev
          </button>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 rounded border text-sm disabled:opacity-40 hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
