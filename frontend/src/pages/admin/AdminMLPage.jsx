import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api.js'
import { AdminHeader, Spinner, ErrorMsg } from './AdminDashboard.jsx'
import { getToken } from '../../lib/getToken.js'

const STATUS_OPTIONS = ['', 'IDLE', 'TRAINING']
const STATUS_COLOR = {
  IDLE:     { bg: 'var(--color-gray-100)', text: 'var(--text-muted)' },
  TRAINING: { bg: 'var(--color-blue-50)',  text: 'var(--color-blue-700)' },
}

function StatusBadge({ status }) {
  const colors = STATUS_COLOR[status] || STATUS_COLOR.IDLE
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {status}
    </span>
  )
}

export default function AdminMLPage() {
  const [models, setModels]     = useState([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [search, setSearch]     = useState('')
  const [status, setStatus]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [confirming, setConfirming] = useState(null) // model id pending delete confirm

  const limit = 25

  const load = useCallback(async (p = page) => {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await api.admin.listModels(token, search, status, p, limit)
      setModels(res.models)
      setTotal(res.total)
      setPage(p)
    } catch {
      setError('Failed to load models.')
    } finally {
      setLoading(false)
    }
  }, [search, status, page])

  useEffect(() => { load(1) }, [search, status])

  async function handleFeature(model) {
    try {
      const token = await getToken()
      await api.admin.featureModel(model.id, token)
      setModels(ms => ms.map(m => m.id === model.id ? { ...m, featured: !m.featured } : m))
    } catch { /* non-fatal */ }
  }

  async function handleDelete(id) {
    setDeleting(id)
    try {
      const token = await getToken()
      await api.admin.deleteModel(id, token)
      setModels(ms => ms.filter(m => m.id !== id))
      setTotal(t => t - 1)
    } catch { /* non-fatal */ } finally {
      setDeleting(null)
      setConfirming(null)
    }
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <AdminHeader title="ML Models" subtitle={`${total} model${total !== 1 ? 's' : ''} total`} />

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Search by name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
        />
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
        >
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s || 'All statuses'}</option>
          ))}
        </select>
      </div>

      {loading && <Spinner />}
      {error && <ErrorMsg>{error}</ErrorMsg>}

      {!loading && models.length === 0 && !error && (
        <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>No models found.</p>
      )}

      {models.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
        >
          {/* Table header */}
          <div
            className="grid gap-2 px-4 py-2 text-[10px] font-semibold uppercase tracking-widest border-b"
            style={{
              gridTemplateColumns: '1fr 120px 90px 80px 80px 60px 120px',
              backgroundColor: 'var(--bg-base)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-muted)',
            }}
          >
            <span>Model</span>
            <span>Owner</span>
            <span>Algorithm</span>
            <span>Status</span>
            <span className="text-right">Episodes</span>
            <span className="text-right">ELO</span>
            <span className="text-right">Actions</span>
          </div>

          {models.map(m => (
            <div
              key={m.id}
              className="grid gap-2 px-4 py-3 items-center border-b last:border-0 transition-colors hover:bg-[var(--bg-surface-hover)]"
              style={{
                gridTemplateColumns: '1fr 120px 90px 80px 80px 60px 120px',
                borderColor: 'var(--border-default)',
                backgroundColor: 'var(--bg-surface)',
              }}
            >
              {/* Name */}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate">
                  {m.featured && <span className="text-xs shrink-0" title="Featured">⭐</span>}
                  <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                    {m.name}
                  </span>
                </div>
                <div className="text-[10px] tabular-nums mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                  {m.id.slice(-8)} · {m._count?.sessions ?? 0} session{m._count?.sessions !== 1 ? 's' : ''}
                </div>
              </div>

              {/* Owner */}
              <div className="truncate text-xs" style={{ color: m.creatorName ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                {m.creatorName ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
              </div>

              {/* Algorithm */}
              <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                {m.algorithm?.replace(/_/g, '-')}
              </div>

              {/* Status */}
              <div><StatusBadge status={m.status} /></div>

              {/* Episodes */}
              <div className="text-xs text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                {m.totalEpisodes.toLocaleString()}
              </div>

              {/* ELO */}
              <div className="text-xs text-right tabular-nums font-semibold" style={{ color: 'var(--color-blue-600)' }}>
                {Math.round(m.eloRating)}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-1">
                <button
                  onClick={() => handleFeature(m)}
                  title={m.featured ? 'Unfeature' : 'Feature'}
                  className="px-2 py-1 rounded text-xs transition-colors hover:bg-[var(--bg-surface-hover)]"
                  style={{ color: m.featured ? 'var(--color-amber-600)' : 'var(--text-muted)' }}
                >
                  {m.featured ? '⭐' : '☆'}
                </button>

                {confirming === m.id ? (
                  <>
                    <button
                      onClick={() => handleDelete(m.id)}
                      disabled={deleting === m.id}
                      className="px-2 py-1 rounded text-xs font-semibold transition-colors"
                      style={{ backgroundColor: 'var(--color-red-600)', color: 'white' }}
                    >
                      {deleting === m.id ? '…' : 'Confirm'}
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="px-2 py-1 rounded text-xs transition-colors hover:bg-[var(--bg-surface-hover)]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirming(m.id)}
                    title="Delete model"
                    className="px-2 py-1 rounded text-xs transition-colors hover:text-[var(--color-red-600)] hover:bg-[var(--color-red-50)]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: 'var(--text-muted)' }}>
            Page {page} of {totalPages} · {total} models
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => load(page - 1)}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40 transition-colors hover:bg-[var(--bg-surface-hover)]"
              style={{ borderColor: 'var(--border-default)' }}
            >
              ← Prev
            </button>
            <button
              onClick={() => load(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40 transition-colors hover:bg-[var(--bg-surface-hover)]"
              style={{ borderColor: 'var(--border-default)' }}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
