import React, { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { tournamentApi } from '../../lib/tournamentApi.js'
import { AdminHeader, Spinner, ErrorMsg } from './AdminDashboard.jsx'
import { getToken } from '../../lib/getToken.js'
import {
  ListTable, ListTh, ListTd, ListTr,
  ListPagination,
} from '../../components/ui/ListTable.jsx'
import TournamentForm from '../../components/tournament/TournamentForm.jsx'

const LIMIT = 25

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  DRAFT:               { bg: 'var(--color-gray-100)',   text: 'var(--text-muted)',          label: 'Draft' },
  REGISTRATION_OPEN:   { bg: 'var(--color-teal-50)',    text: 'var(--color-teal-700)',       label: 'Open' },
  REGISTRATION_CLOSED: { bg: 'var(--color-amber-50)',   text: 'var(--color-amber-700)',      label: 'Reg Closed' },
  IN_PROGRESS:         { bg: 'var(--color-blue-50)',    text: 'var(--color-blue-700)',       label: 'In Progress' },
  COMPLETED:           { bg: 'var(--color-gray-100)',   text: 'var(--text-secondary)',       label: 'Completed' },
  CANCELLED:           { bg: 'var(--color-red-50)',     text: 'var(--color-red-600)',        label: 'Cancelled' },
}

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT
  return (
    <span
      className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.text }}
    >
      {s.label}
    </span>
  )
}

// ── Create / Edit modal ───────────────────────────────────────────────────────

function TournamentModal({ tournament, token, onSaved, onClose }) {
  const isEdit = !!tournament

  async function handleSubmit(data) {
    if (isEdit) {
      await tournamentApi.update(tournament.id, data, token)
    } else {
      await tournamentApi.create(data, token)
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        className="relative w-full max-w-xl mt-8 mb-8 rounded-xl border p-6 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-md)' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            {isEdit ? 'Edit Tournament' : 'Create Tournament'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-surface-hover)]"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </div>
        <TournamentForm
          initialValues={tournament}
          onSubmit={handleSubmit}
          onCancel={onClose}
          submitLabel={isEdit ? 'Save Changes' : 'Create Tournament'}
        />
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminTournamentsPage() {
  const [tournaments, setTournaments] = useState([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [actionError, setActionError] = useState(null)
  const [token, setToken]     = useState(null)
  const [modal, setModal]     = useState(null) // null | 'create' | { tournament }

  const totalPages = Math.ceil(total / LIMIT)

  // Fetch token once
  useEffect(() => {
    getToken().then(setToken).catch(() => {})
  }, [])

  const load = useCallback(async (p) => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const data = await tournamentApi.list({}, token)
      const list = Array.isArray(data) ? data : (data.tournaments ?? [])
      // Client-side pagination since the API may not support it
      setTotal(list.length)
      const start = (p - 1) * LIMIT
      setTournaments(list.slice(start, start + LIMIT))
    } catch {
      setError('Failed to load tournaments.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (token) load(page)
  }, [token, page, load])

  async function performAction(action, tournament, label) {
    if (!confirm(`${label} "${tournament.name}"?`)) return
    setActionError(null)
    try {
      await tournamentApi[action](tournament.id, token)
      load(page)
    } catch (e) {
      setActionError(e.message || `${label} failed.`)
    }
  }

  function handleSaved() {
    setModal(null)
    load(page)
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <AdminHeader
        title="Tournaments"
        subtitle={`${total} total`}
      />

      {/* Create button */}
      <div className="flex justify-end">
        <button
          onClick={() => setModal('create')}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110"
          style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
        >
          + Create Tournament
        </button>
      </div>

      {actionError && <ErrorMsg>{actionError}</ErrorMsg>}
      {loading && <Spinner />}
      {error && <ErrorMsg>{error}</ErrorMsg>}

      {!loading && (
        <ListTable maxHeight="65vh">
          <thead>
            <tr>
              <ListTh>Name</ListTh>
              <ListTh className="hidden sm:table-cell">Status</ListTh>
              <ListTh className="hidden md:table-cell">Format</ListTh>
              <ListTh className="hidden md:table-cell">Mode</ListTh>
              <ListTh align="right" className="hidden lg:table-cell">Players</ListTh>
              <ListTh className="hidden lg:table-cell">Start</ListTh>
              <ListTh align="right">Actions</ListTh>
            </tr>
          </thead>
          <tbody>
            {tournaments.map((t, i) => {
              const participantCount = t.participants?.length ?? t._count?.participants ?? 0
              const canEdit    = t.status === 'DRAFT'
              const canPublish = t.status === 'DRAFT'
              const canStart   = t.status === 'REGISTRATION_OPEN' || t.status === 'REGISTRATION_CLOSED'
              const canCancel  = t.status !== 'COMPLETED' && t.status !== 'CANCELLED'

              return (
                <ListTr key={t.id} last={i === tournaments.length - 1}>
                  {/* Name */}
                  <ListTd>
                    <Link
                      to={`/tournaments/${t.id}`}
                      className="font-medium text-sm hover:underline"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {t.name}
                    </Link>
                    {t.description && (
                      <p className="text-[10px] truncate max-w-[180px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {t.description}
                      </p>
                    )}
                  </ListTd>

                  {/* Status */}
                  <ListTd className="hidden sm:table-cell">
                    <StatusBadge status={t.status} />
                  </ListTd>

                  {/* Format */}
                  <ListTd className="hidden md:table-cell">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {t.bracketType?.replace('_', ' ')}
                    </span>
                  </ListTd>

                  {/* Mode */}
                  <ListTd className="hidden md:table-cell">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.mode}</span>
                  </ListTd>

                  {/* Players */}
                  <ListTd align="right" className="hidden lg:table-cell">
                    <span className="text-xs tabular-nums font-mono" style={{ color: 'var(--color-blue-600)' }}>
                      {participantCount}
                      {t.maxParticipants ? `/${t.maxParticipants}` : ''}
                    </span>
                  </ListTd>

                  {/* Start */}
                  <ListTd className="hidden lg:table-cell">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {t.startTime ? new Date(t.startTime).toLocaleString() : '—'}
                    </span>
                  </ListTd>

                  {/* Actions */}
                  <ListTd align="right">
                    <div className="flex items-center gap-1 justify-end flex-wrap">
                      <Link
                        to={`/tournaments/${t.id}`}
                        className="text-xs px-2 py-1 rounded border no-underline transition-colors hover:bg-[var(--bg-surface-hover)]"
                        style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
                      >
                        View
                      </Link>
                      {canEdit && (
                        <button
                          onClick={() => setModal({ tournament: t })}
                          className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)]"
                          style={{ borderColor: 'var(--color-blue-300)', color: 'var(--color-blue-600)' }}
                        >
                          Edit
                        </button>
                      )}
                      {canPublish && (
                        <button
                          onClick={() => performAction('publish', t, 'Publish')}
                          className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--color-teal-50)]"
                          style={{ borderColor: 'var(--color-teal-300)', color: 'var(--color-teal-600)' }}
                        >
                          Publish
                        </button>
                      )}
                      {canStart && (
                        <button
                          onClick={() => performAction('start', t, 'Start')}
                          className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--color-blue-50)]"
                          style={{ borderColor: 'var(--color-blue-300)', color: 'var(--color-blue-600)' }}
                        >
                          Start
                        </button>
                      )}
                      {canCancel && (
                        <button
                          onClick={() => performAction('cancel', t, 'Cancel')}
                          className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--color-red-50)] hover:text-[var(--color-red-600)]"
                          style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </ListTd>
                </ListTr>
              )
            })}
          </tbody>
        </ListTable>
      )}

      {!loading && tournaments.length === 0 && !error && (
        <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>
          No tournaments found. Create one above.
        </p>
      )}

      <ListPagination
        page={page}
        totalPages={totalPages}
        total={total}
        limit={LIMIT}
        onPageChange={setPage}
        noun="tournaments"
      />

      {/* Create / Edit modal */}
      {modal && (
        <TournamentModal
          tournament={modal === 'create' ? null : modal.tournament}
          token={token}
          onSaved={handleSaved}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
