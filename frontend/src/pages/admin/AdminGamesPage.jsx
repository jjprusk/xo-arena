import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api.js'
import { AdminHeader, Spinner, ErrorMsg } from './AdminDashboard.jsx'

async function getToken() {
  return window.Clerk?.session?.getToken() ?? null
}

const OUTCOME_LABEL = {
  PLAYER1_WIN: 'P1 Win',
  PLAYER2_WIN: 'P2 Win',
  AI_WIN: 'AI Win',
  DRAW: 'Draw',
}
const OUTCOME_COLOR = {
  PLAYER1_WIN: 'var(--color-teal-600)',
  PLAYER2_WIN: 'var(--color-blue-600)',
  AI_WIN: 'var(--color-red-600)',
  DRAW: 'var(--color-amber-600)',
}

export default function AdminGamesPage() {
  const [games, setGames]     = useState([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [modeFilter, setModeFilter]       = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [actionError, setActionError] = useState(null)

  const LIMIT = 25
  const totalPages = Math.ceil(total / LIMIT)

  const load = useCallback(async (p, mode, outcome) => {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const filters = {}
      if (mode) filters.mode = mode
      if (outcome) filters.outcome = outcome
      const { games: g, total: t } = await api.admin.games(token, p, LIMIT, filters)
      setGames(g)
      setTotal(t)
    } catch {
      setError('Failed to load games.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(page, modeFilter, outcomeFilter) }, [page, modeFilter, outcomeFilter, load])

  function handleFilterChange(setter) {
    return (e) => { setter(e.target.value); setPage(1) }
  }

  async function deleteGame(id) {
    if (!confirm('Delete this game record? This cannot be undone.')) return
    setActionError(null)
    try {
      const token = await getToken()
      await api.admin.deleteGame(id, token)
      setGames(prev => prev.filter(g => g.id !== id))
      setTotal(t => t - 1)
    } catch {
      setActionError('Delete failed.')
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <AdminHeader title="Games" subtitle={`${total} total`} />

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <select
          value={modeFilter}
          onChange={handleFilterChange(setModeFilter)}
          className="px-3 py-2 rounded-lg border text-sm focus:outline-none"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
        >
          <option value="">All modes</option>
          <option value="pvai">PvAI</option>
          <option value="pvp">PvP</option>
        </select>
        <select
          value={outcomeFilter}
          onChange={handleFilterChange(setOutcomeFilter)}
          className="px-3 py-2 rounded-lg border text-sm focus:outline-none"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
        >
          <option value="">All outcomes</option>
          <option value="player1_win">P1 Win</option>
          <option value="ai_win">AI Win</option>
          <option value="draw">Draw</option>
        </select>
      </div>

      {actionError && <ErrorMsg>{actionError}</ErrorMsg>}
      {loading && <Spinner />}
      {error && <ErrorMsg>{error}</ErrorMsg>}

      {!loading && games.length > 0 && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)' }}>
                {['Player(s)', 'Mode', 'Outcome', 'Moves', 'Duration', 'Date', ''].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wide first:table-cell" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {games.map((g, i) => (
                <tr
                  key={g.id}
                  style={{
                    backgroundColor: i % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-base)',
                    borderBottom: '1px solid var(--border-default)',
                  }}
                >
                  <td className="px-4 py-2.5">
                    <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                      {g.player1?.displayName ?? '—'}
                    </div>
                    {g.player2 && (
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        vs {g.player2.displayName}
                      </div>
                    )}
                    {!g.player2 && g.mode === 'PVAI' && (
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        vs AI {g.difficulty ? `(${g.difficulty.toLowerCase()})` : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {g.mode === 'PVAI' ? 'PvAI' : 'PvP'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className="text-xs font-semibold px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${OUTCOME_COLOR[g.outcome]} 12%, transparent)`,
                        color: OUTCOME_COLOR[g.outcome],
                      }}
                    >
                      {OUTCOME_LABEL[g.outcome] ?? g.outcome}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {g.totalMoves}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {(g.durationMs / 1000).toFixed(1)}s
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {new Date(g.endedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => deleteGame(g.id)}
                      className="text-xs px-2 py-0.5 rounded border hover:bg-[var(--color-red-50)] transition-colors"
                      style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
                      title="Delete game"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && games.length === 0 && !error && (
        <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>No games found.</p>
      )}

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
