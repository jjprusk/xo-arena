import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api.js'
import { AdminHeader, Spinner, ErrorMsg } from './AdminDashboard.jsx'
import { getToken } from '../../lib/getToken.js'
import { useSession } from '../../lib/auth-client.js'

export default function AdminUsersPage() {
  const { data: session } = useSession()
  const [users, setUsers]     = useState([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [search, setSearch]   = useState('')
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

  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Debounce the raw search input by 300ms
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(id)
  }, [search])

  // Reset to page 1 when the debounced search term changes
  useEffect(() => { setPage(1) }, [debouncedSearch])

  // Load whenever the committed search or page changes (pagination is immediate)
  useEffect(() => { load(debouncedSearch, page) }, [debouncedSearch, page, load])

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

  async function toggleRole(user, role) {
    setActionError(null)
    try {
      const token = await getToken()
      if (role === 'admin') {
        const newBaRole = user.baRole === 'admin' ? null : 'admin'
        const updated = await api.admin.updateUser(user.id, { baRole: newBaRole }, token)
        setUsers(prev => prev.map(u => u.id === user.id ? { ...u, baRole: updated.user.baRole } : u))
      } else {
        // role is already the correct enum value (e.g. 'BOT_ADMIN', 'TOURNAMENT_ADMIN')
        const current = user.roles ?? []
        const newRoles = current.includes(role) ? current.filter(r => r !== role) : [...current, role]
        const updated = await api.admin.updateUser(user.id, { roles: newRoles }, token)
        setUsers(prev => prev.map(u => u.id === user.id ? { ...u, roles: updated.user.roles ?? [] } : u))
      }
    } catch {
      setActionError('Role update failed.')
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
      <div className="flex gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, email or username…"
          className="flex-1 px-3 py-2 rounded-lg border text-sm focus:outline-none"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
        />
        {search && (
          <button type="button" onClick={() => setSearch('')}
            className="px-3 py-2 rounded-lg text-sm border hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            Clear
          </button>
        )}
      </div>

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
                        <div className="flex items-center gap-1 flex-wrap mt-0.5">
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>@{u.username}</span>
                          {u.baRole === 'admin' && (
                            <span className="text-xs font-semibold px-1.5 py-0 rounded-full" style={{ backgroundColor: 'var(--color-purple-100)', color: 'var(--color-purple-700)' }}>admin</span>
                          )}
                          {(u.roles ?? []).includes('TOURNAMENT_ADMIN') && (
                            <span className="text-xs font-semibold px-1.5 py-0 rounded-full" style={{ backgroundColor: 'var(--color-orange-100)', color: 'var(--color-orange-700)' }}>tournament</span>
                          )}
                          {(u.roles ?? []).includes('BOT_ADMIN') && (
                            <span className="text-xs font-semibold px-1.5 py-0 rounded-full" style={{ backgroundColor: 'var(--color-teal-100)', color: 'var(--color-teal-700)' }}>bot admin</span>
                          )}
                        </div>
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
                      const isSelf = u.betterAuthId === session?.user?.id
                      return (
                    <div className="flex items-center gap-1.5 justify-end flex-wrap">
                      <button
                        onClick={() => !isSelf && toggleRole(u, 'admin')}
                        disabled={isSelf}
                        className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{
                          borderColor: 'var(--color-purple-300)',
                          color: u.baRole === 'admin' ? 'var(--color-purple-700)' : 'var(--text-muted)',
                          fontWeight: u.baRole === 'admin' ? 600 : 400,
                        }}
                        title={isSelf ? 'Cannot change your own admin role' : (u.baRole === 'admin' ? 'Remove admin' : 'Make admin')}
                      >
                        admin
                      </button>
                      <button
                        onClick={() => toggleRole(u, 'BOT_ADMIN')}
                        className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)]"
                        style={{
                          borderColor: 'var(--color-teal-300)',
                          color: (u.roles ?? []).includes('BOT_ADMIN') ? 'var(--color-teal-700)' : 'var(--text-muted)',
                          fontWeight: (u.roles ?? []).includes('BOT_ADMIN') ? 600 : 400,
                        }}
                        title={(u.roles ?? []).includes('BOT_ADMIN') ? 'Remove bot admin role' : 'Grant bot admin role'}
                      >
                        bot admin
                      </button>
                      <button
                        onClick={() => toggleRole(u, 'TOURNAMENT_ADMIN')}
                        className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)]"
                        style={{
                          borderColor: 'var(--color-orange-300)',
                          color: (u.roles ?? []).includes('TOURNAMENT_ADMIN') ? 'var(--color-orange-700)' : 'var(--text-muted)',
                          fontWeight: (u.roles ?? []).includes('TOURNAMENT_ADMIN') ? 600 : 400,
                        }}
                        title={(u.roles ?? []).includes('TOURNAMENT_ADMIN') ? 'Remove tournament role' : 'Grant tournament role'}
                      >
                        tourn.
                      </button>
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
