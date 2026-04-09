import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api.js'
import { AdminHeader, Spinner, ErrorMsg } from './AdminDashboard.jsx'
import { getToken } from '../../lib/getToken.js'
import {
  ListTable, ListTh, ListTd, ListTr,
  SearchBar, ListPagination,
} from '../../components/ui/ListTable.jsx'

const LIMIT = 25

const ALGO_COLOR = {
  dqn:              { bg: 'var(--color-blue-50)',   text: 'var(--color-blue-700)'  },
  policy_gradient:  { bg: 'var(--color-teal-50)',   text: 'var(--color-teal-700)'  },
  alpha_zero:       { bg: 'var(--color-amber-50)',  text: 'var(--color-amber-700)' },
  q_learning:       { bg: 'var(--color-purple-50)', text: 'var(--color-purple-700)'},
  sarsa:            { bg: 'var(--color-orange-50)', text: 'var(--color-orange-700)'},
  monte_carlo:      { bg: 'var(--color-red-50)',    text: 'var(--color-red-700)'   },
}

function AlgoBadge({ algorithm }) {
  const key = algorithm?.toLowerCase()
  const c   = ALGO_COLOR[key] ?? { bg: 'var(--color-gray-100)', text: 'var(--text-muted)' }
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {algorithm?.replace(/_/g, '-') ?? '—'}
    </span>
  )
}

function TrainingBadge({ status }) {
  const training = status === 'TRAINING'
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
      style={{
        backgroundColor: training ? 'var(--color-blue-50)'  : 'var(--color-gray-100)',
        color:           training ? 'var(--color-blue-700)' : 'var(--text-muted)',
      }}
    >
      {training && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-blue-500)' }} />}
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
  const [confirming, setConfirming] = useState(null)
  const [deleting, setDeleting]     = useState(null)
  const [editingMax, setEditingMax] = useState(null)
  const [maxInput, setMaxInput]     = useState('')
  const [savingMax, setSavingMax]   = useState(null)

  const totalPages = Math.ceil(total / LIMIT)

  const load = useCallback(async (p = 1) => {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const res   = await api.admin.listModels(token, search, status, p, LIMIT)
      setModels(res.models)
      setTotal(res.total)
      setPage(p)
    } catch {
      setError('Failed to load models.')
    } finally {
      setLoading(false)
    }
  }, [search, status])

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

  async function handleSaveMax(id) {
    const v = parseInt(maxInput)
    if (isNaN(v) || v < 0) return
    setSavingMax(id)
    try {
      const token = await getToken()
      const { model } = await api.admin.setModelMaxEpisodes(id, v, token)
      setModels(ms => ms.map(m => m.id === id ? { ...m, maxEpisodes: model.maxEpisodes } : m))
    } catch (err) {
      alert(err.message || 'Failed to update limit')
    } finally {
      setSavingMax(null)
      setEditingMax(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <AdminHeader title="ML Models" subtitle={`${total} model${total !== 1 ? 's' : ''} total`} />

      <div className="flex flex-wrap gap-2">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search by name…"
          className="flex-1 min-w-[180px]"
        />
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="px-3 py-2 rounded-lg border text-sm focus:outline-none"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
        >
          <option value="">All statuses</option>
          <option value="IDLE">Idle</option>
          <option value="TRAINING">Training</option>
        </select>
      </div>

      {loading && <Spinner />}
      {error   && <ErrorMsg>{error}</ErrorMsg>}

      {!loading && (
        <ListTable maxHeight="65vh">
          <thead>
            <tr>
              <ListTh>Model</ListTh>
              <ListTh className="hidden sm:table-cell">Owner</ListTh>
              <ListTh className="hidden md:table-cell">Algorithm</ListTh>
              <ListTh>Status</ListTh>
              <ListTh align="right" className="hidden lg:table-cell">Episodes / Limit</ListTh>
              <ListTh align="right">ELO</ListTh>
              <ListTh align="right">Actions</ListTh>
            </tr>
          </thead>
          <tbody>
            {models.map((m, i) => {
              const pct     = m.maxEpisodes > 0 ? Math.min(100, Math.round((m.totalEpisodes / m.maxEpisodes) * 100)) : null
              const atLimit = m.maxEpisodes > 0 && m.totalEpisodes >= m.maxEpisodes
              return (
                <ListTr key={m.id} last={i === models.length - 1}>

                  <ListTd>
                    <div className="flex items-center gap-1.5 min-w-0">
                      {m.featured && <span className="text-xs shrink-0" title="Featured">⭐</span>}
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                          {m.name}
                        </div>
                        <div className="text-[10px] tabular-nums mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                          {m.id.slice(-8)} · {m._count?.sessions ?? 0} session{m._count?.sessions !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                  </ListTd>

                  <ListTd className="hidden sm:table-cell">
                    <span className="text-xs truncate block max-w-[120px]">
                      {m.creatorName ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </span>
                  </ListTd>

                  <ListTd className="hidden md:table-cell">
                    <AlgoBadge algorithm={m.algorithm} />
                  </ListTd>

                  <ListTd>
                    <TrainingBadge status={m.status} />
                  </ListTd>

                  <ListTd align="right" className="hidden lg:table-cell">
                    {editingMax === m.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="number"
                          min={m.maxEpisodes}
                          value={maxInput}
                          onChange={e => setMaxInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveMax(m.id); if (e.key === 'Escape') setEditingMax(null) }}
                          autoFocus
                          className="w-20 text-xs rounded border px-1 py-0.5 outline-none tabular-nums text-right"
                          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--color-blue-400)', color: 'var(--text-primary)' }}
                        />
                        <button
                          onClick={() => handleSaveMax(m.id)}
                          disabled={savingMax === m.id}
                          className="text-[10px] px-1.5 py-0.5 rounded font-semibold text-white"
                          style={{ backgroundColor: 'var(--color-blue-600)' }}
                        >
                          {savingMax === m.id ? '…' : 'OK'}
                        </button>
                        <button
                          onClick={() => setEditingMax(null)}
                          className="text-[10px] px-1 py-0.5 rounded"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingMax(m.id); setMaxInput(m.maxEpisodes) }}
                        className="text-xs tabular-nums hover:underline"
                        title="Click to change episode limit"
                        style={{ color: atLimit ? 'var(--color-red-600)' : 'var(--text-secondary)' }}
                      >
                        {m.totalEpisodes.toLocaleString()} / {m.maxEpisodes > 0 ? m.maxEpisodes.toLocaleString() : '∞'}
                        {pct !== null && (
                          <span className="ml-1 text-[10px]" style={{ color: atLimit ? 'var(--color-red-500)' : 'var(--text-muted)' }}>
                            ({pct}%)
                          </span>
                        )}
                      </button>
                    )}
                  </ListTd>

                  <ListTd align="right">
                    <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--color-blue-600)' }}>
                      {Math.round(m.eloRating)}
                    </span>
                  </ListTd>

                  <ListTd align="right">
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
                            className="px-2 py-1 rounded text-xs font-semibold text-white"
                            style={{ backgroundColor: 'var(--color-red-600)' }}
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
                          className="px-2 py-1 rounded text-xs transition-colors hover:text-[var(--color-red-600)] hover:bg-[var(--color-red-50)]"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          Delete
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

      {!loading && models.length === 0 && !error && (
        <p className="text-sm text-center py-10" style={{ color: 'var(--text-muted)' }}>
          No models found.
        </p>
      )}

      <ListPagination
        page={page}
        totalPages={totalPages}
        total={total}
        limit={LIMIT}
        onPageChange={load}
        noun="models"
      />
    </div>
  )
}
