import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api.js'
import { AdminHeader, Spinner, ErrorMsg } from './AdminDashboard.jsx'
import { getToken } from '../../lib/getToken.js'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import {
  ListTable, ListTh, ListTd, ListTr,
  UserAvatar, SearchBar, ListPagination,
} from '../../components/ui/ListTable.jsx'

const LIMIT = 25

export default function AdminUsersPage() {
  const { data: session } = useOptimisticSession()
  const [users, setUsers]     = useState([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [search, setSearch]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [editingElo, setEditingElo]   = useState(null) // { id, value }
  const [actionError, setActionError] = useState(null)

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
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(id)
  }, [search])
  useEffect(() => { setPage(1) }, [debouncedSearch])
  useEffect(() => { load(debouncedSearch, page) }, [debouncedSearch, page, load])

  async function toggleBan(user) {
    setActionError(null)
    try {
      const token = await getToken()
      const updated = await api.admin.updateUser(user.id, { banned: !user.banned }, token)
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, banned: updated.user.banned } : u))
    } catch { setActionError('Action failed. Try again.') }
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
        const current  = user.roles ?? []
        const newRoles = current.includes(role) ? current.filter(r => r !== role) : [...current, role]
        const updated  = await api.admin.updateUser(user.id, { roles: newRoles }, token)
        setUsers(prev => prev.map(u => u.id === user.id ? { ...u, roles: updated.user.roles ?? [] } : u))
      }
    } catch { setActionError('Role update failed.') }
  }

  async function saveElo(id) {
    const val = parseFloat(editingElo.value)
    if (isNaN(val)) { setEditingElo(null); return }
    setActionError(null)
    try {
      const token = await getToken()
      const updated = await api.admin.updateUser(id, { eloRating: val }, token)
      setUsers(prev => prev.map(u => u.id === id ? { ...u, eloRating: updated.user.eloRating } : u))
    } catch { setActionError('ELO update failed.') } finally { setEditingElo(null) }
  }

  async function verifyEmail(user) {
    setActionError(null)
    try {
      const token = await getToken()
      const updated = await api.admin.updateUser(user.id, { emailVerified: true }, token)
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, emailVerified: updated.user.emailVerified } : u))
    } catch { setActionError('Verify failed.') }
  }

  async function deleteUser(user) {
    if (!confirm(`Delete ${user.displayName}? This cannot be undone.`)) return
    setActionError(null)
    try {
      const token = await getToken()
      await api.admin.deleteUser(user.id, token)
      setUsers(prev => prev.filter(u => u.id !== user.id))
      setTotal(t => t - 1)
    } catch { setActionError('Delete failed.') }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <AdminHeader title="Users" subtitle={`${total} total`} />

      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search name, email or username…"
      />

      {actionError && <ErrorMsg>{actionError}</ErrorMsg>}
      {loading && <Spinner />}
      {error   && <ErrorMsg>{error}</ErrorMsg>}

      {!loading && (
        <ListTable maxHeight="60vh">
          <thead>
            <tr>
              <ListTh>User</ListTh>
              <ListTh className="hidden sm:table-cell">Email</ListTh>
              <ListTh align="right">ELO</ListTh>
              <ListTh align="right" className="hidden md:table-cell">Games</ListTh>
              <ListTh align="center">Status</ListTh>
              <ListTh />
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => {
              const isSelf = u.betterAuthId === session?.user?.id
              return (
                <ListTr key={u.id} dimmed={u.banned} last={i === users.length - 1}>

                  {/* Identity */}
                  <ListTd>
                    <div className="flex items-center gap-2.5">
                      <UserAvatar user={u} size="sm" />
                      <div className="min-w-0">
                        <div className="font-medium leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
                          {u.displayName}
                        </div>
                        <div className="flex items-center gap-1 flex-wrap mt-0.5">
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>@{u.username}</span>
                          {u.baRole === 'admin' && <Badge color="purple">admin</Badge>}
                          {(u.roles ?? []).includes('TOURNAMENT_ADMIN') && <Badge color="orange">tournament</Badge>}
                          {(u.roles ?? []).includes('BOT_ADMIN')        && <Badge color="teal">bot admin</Badge>}
                          {(u.roles ?? []).includes('SUPPORT')          && <Badge color="blue">support</Badge>}
                        </div>
                      </div>
                    </div>
                  </ListTd>

                  {/* Email */}
                  <ListTd className="hidden sm:table-cell max-w-[180px]">
                    <span className="block truncate text-xs">{u.email}</span>
                    {u.emailVerified === false && (
                      <span className="text-[10px] font-semibold px-1.5 py-px rounded-full" style={{ backgroundColor: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}>
                        unverified
                      </span>
                    )}
                  </ListTd>

                  {/* ELO — inline edit */}
                  <ListTd align="right">
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
                        className="font-mono font-semibold hover:underline tabular-nums"
                        style={{ color: 'var(--color-blue-600)' }}
                        title="Click to edit ELO"
                      >
                        {Math.round(u.eloRating)}
                      </button>
                    )}
                  </ListTd>

                  {/* Games */}
                  <ListTd align="right" className="hidden md:table-cell">
                    <span className="tabular-nums">{u._count.gamesAsPlayer1}</span>
                  </ListTd>

                  {/* Status badge */}
                  <ListTd align="center">
                    <StatusBadge active={!u.banned} />
                  </ListTd>

                  {/* Actions */}
                  <ListTd>
                    <div className="flex items-center gap-1.5 justify-end flex-wrap">
                      <RoleButton
                        active={u.baRole === 'admin'}
                        disabled={isSelf}
                        color="purple"
                        title={isSelf ? 'Cannot change your own admin role' : u.baRole === 'admin' ? 'Remove admin' : 'Make admin'}
                        onClick={() => !isSelf && toggleRole(u, 'admin')}
                      >
                        admin
                      </RoleButton>
                      <RoleButton
                        active={(u.roles ?? []).includes('BOT_ADMIN')}
                        color="teal"
                        title={(u.roles ?? []).includes('BOT_ADMIN') ? 'Remove bot admin' : 'Grant bot admin'}
                        onClick={() => toggleRole(u, 'BOT_ADMIN')}
                      >
                        bot admin
                      </RoleButton>
                      <RoleButton
                        active={(u.roles ?? []).includes('TOURNAMENT_ADMIN')}
                        color="orange"
                        title={(u.roles ?? []).includes('TOURNAMENT_ADMIN') ? 'Remove tournament' : 'Grant tournament'}
                        onClick={() => toggleRole(u, 'TOURNAMENT_ADMIN')}
                      >
                        tourn.
                      </RoleButton>
                      <RoleButton
                        active={(u.roles ?? []).includes('SUPPORT')}
                        color="blue"
                        title={(u.roles ?? []).includes('SUPPORT') ? 'Remove support' : 'Grant support'}
                        onClick={() => toggleRole(u, 'SUPPORT')}
                      >
                        support
                      </RoleButton>
                      {u.emailVerified === false && (
                        <ActionButton
                          title="Mark email as verified so user can sign in"
                          onClick={() => verifyEmail(u)}
                        >
                          Verify
                        </ActionButton>
                      )}
                      <ActionButton
                        disabled={isSelf}
                        danger={!u.banned}
                        title={isSelf ? 'Cannot ban yourself' : undefined}
                        onClick={() => !isSelf && toggleBan(u)}
                      >
                        {u.banned ? 'Unban' : 'Ban'}
                      </ActionButton>
                      <ActionButton
                        disabled={isSelf}
                        title={isSelf ? 'Cannot delete yourself' : 'Delete user'}
                        onClick={() => !isSelf && deleteUser(u)}
                      >
                        ✕
                      </ActionButton>
                    </div>
                  </ListTd>
                </ListTr>
              )
            })}
          </tbody>
        </ListTable>
      )}

      {!loading && users.length === 0 && !error && (
        <p className="text-sm text-center py-10" style={{ color: 'var(--text-muted)' }}>
          No users found.
        </p>
      )}

      <ListPagination
        page={page}
        totalPages={totalPages}
        total={total}
        limit={LIMIT}
        onPageChange={setPage}
        noun="users"
      />
    </div>
  )
}

// ── Local helpers ─────────────────────────────────────────────────────────────

const COLOR_MAP = {
  purple: { bg: 'var(--color-purple-100)', text: 'var(--color-purple-700)', border: 'var(--color-purple-300)' },
  teal:   { bg: 'var(--color-teal-100)',   text: 'var(--color-teal-700)',   border: 'var(--color-teal-300)'   },
  orange: { bg: 'var(--color-orange-100)', text: 'var(--color-orange-700)', border: 'var(--color-orange-300)' },
  blue:   { bg: 'var(--color-blue-100)',   text: 'var(--color-blue-700)',   border: 'var(--color-blue-300)'   },
}

function Badge({ color, children }) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.purple
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-px rounded-full leading-none"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {children}
    </span>
  )
}

function StatusBadge({ active }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
      style={{
        backgroundColor: active ? 'var(--color-teal-50)'  : 'var(--color-red-50)',
        color:           active ? 'var(--color-teal-600)' : 'var(--color-red-600)',
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: active ? 'var(--color-teal-500)' : 'var(--color-red-500)' }}
      />
      {active ? 'Active' : 'Banned'}
    </span>
  )
}

function RoleButton({ children, active, disabled, color = 'purple', title, onClick }) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.purple
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-30 disabled:cursor-not-allowed"
      style={{
        borderColor: c.border,
        color:       active ? c.text          : 'var(--text-muted)',
        fontWeight:  active ? 600             : 400,
        backgroundColor: active ? c.bg       : 'transparent',
      }}
    >
      {children}
    </button>
  )
}

function ActionButton({ children, disabled, danger, title, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-30 disabled:cursor-not-allowed"
      style={{
        borderColor: danger ? 'var(--color-red-400)'    : 'var(--border-default)',
        color:       danger ? 'var(--color-red-600)'    : 'var(--text-muted)',
      }}
    >
      {children}
    </button>
  )
}
