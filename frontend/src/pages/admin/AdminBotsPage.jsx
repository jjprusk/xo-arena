import React, { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api.js'
import { AdminHeader, Spinner, ErrorMsg } from './AdminDashboard.jsx'
import { getToken } from '../../lib/getToken.js'

const ALGO_COLORS = {
  minimax: { bg: 'var(--color-blue-50)', text: 'var(--color-blue-700)' },
  ml: { bg: 'var(--color-teal-50)', text: 'var(--color-teal-700)' },
  mcts: { bg: 'var(--color-purple-50)', text: 'var(--color-purple-700)' },
  rule_based: { bg: 'var(--color-amber-50)', text: 'var(--color-amber-700)' },
}

export default function AdminBotsPage() {
  const [bots, setBots]       = useState([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [search, setSearch]   = useState('')
  const [query, setQuery]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [actionError, setActionError] = useState(null)

  // Start bot game state
  const [sgBot1, setSgBot1] = useState('')
  const [sgBot2, setSgBot2] = useState('')
  const [sgStarting, setSgStarting] = useState(false)
  const [sgResult, setSgResult] = useState(null)
  const [sgError, setSgError] = useState(null)

  const LIMIT = 25
  const totalPages = Math.ceil(total / LIMIT)

  const load = useCallback(async (q, p) => {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const { bots: b, total: t } = await api.admin.listBots(token, q, p, LIMIT)
      setBots(b)
      setTotal(t)
    } catch {
      setError('Failed to load bots.')
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

  async function toggleActive(bot) {
    setActionError(null)
    try {
      const token = await getToken()
      const { bot: updated } = await api.admin.updateBot(bot.id, { botActive: !bot.botActive }, token)
      setBots(prev => prev.map(b => b.id === bot.id ? { ...b, botActive: updated.botActive } : b))
    } catch {
      setActionError('Action failed. Try again.')
    }
  }

  async function startBotGame() {
    if (!sgBot1 || !sgBot2 || sgBot1 === sgBot2) return
    setSgStarting(true)
    setSgError(null)
    setSgResult(null)
    try {
      const token = await getToken()
      const { slug, displayName } = await api.botGames.start({ bot1Id: sgBot1, bot2Id: sgBot2 }, token)
      setSgResult({ slug, displayName })
    } catch (err) {
      setSgError(err.message || 'Failed to start game.')
    } finally {
      setSgStarting(false)
    }
  }

  async function deleteBot(bot) {
    if (!confirm(`Delete "${bot.displayName}"? This is permanent and cannot be undone.`)) return
    setActionError(null)
    try {
      const token = await getToken()
      await api.admin.deleteBot(bot.id, token)
      setBots(prev => prev.filter(b => b.id !== bot.id))
      setTotal(t => t - 1)
    } catch {
      setActionError('Delete failed.')
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <AdminHeader title="Bots" subtitle={`${total} total`} />

      {/* Start Bot vs Bot Game */}
      <div
        className="rounded-xl border p-4 space-y-3"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">⚔️</span>
          <span className="text-sm font-semibold">Start Bot vs Bot Game</span>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Bot 1 (X)</label>
            <select
              value={sgBot1}
              onChange={e => setSgBot1(e.target.value)}
              className="px-2 py-1.5 rounded-lg border text-sm"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)', minWidth: '160px' }}
            >
              <option value="">Select bot…</option>
              {bots.filter(b => b.botActive).map(b => (
                <option key={b.id} value={b.id}>{b.displayName} (ELO {Math.round(b.eloRating)})</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Bot 2 (O)</label>
            <select
              value={sgBot2}
              onChange={e => setSgBot2(e.target.value)}
              className="px-2 py-1.5 rounded-lg border text-sm"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)', minWidth: '160px' }}
            >
              <option value="">Select bot…</option>
              {bots.filter(b => b.botActive && b.id !== sgBot1).map(b => (
                <option key={b.id} value={b.id}>{b.displayName} (ELO {Math.round(b.eloRating)})</option>
              ))}
            </select>
          </div>
          <button
            onClick={startBotGame}
            disabled={!sgBot1 || !sgBot2 || sgBot1 === sgBot2 || sgStarting}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #9333ea, #6d28d9)' }}
          >
            {sgStarting ? 'Starting…' : 'Start Game'}
          </button>
        </div>
        {sgError && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{sgError}</p>}
        {sgResult && (
          <p className="text-xs" style={{ color: 'var(--color-teal-600)' }}>
            Game started: <strong>{sgResult.displayName}</strong> —{' '}
            <a
              href={`/play?spectate=${sgResult.slug}`}
              className="underline"
              style={{ color: 'var(--color-blue-600)' }}
            >
              spectate
            </a>
          </p>
        )}
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name…"
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
          <button
            type="button"
            onClick={() => { setSearch(''); setQuery(''); setPage(1) }}
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

      {!loading && bots.length > 0 && (
        <div
          className="rounded-xl border overflow-x-auto overflow-y-auto max-h-[60vh]"
          style={{ borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr
                className="sticky top-0 z-10"
                style={{ backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)' }}
              >
                <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wide hidden sm:table-cell" style={{ color: 'var(--text-muted)' }}>Owner</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wide hidden md:table-cell" style={{ color: 'var(--text-muted)' }}>Algorithm</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>ELO</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {bots.map((bot, i) => {
                const algoStyle = ALGO_COLORS[bot.botModelType] ?? { bg: 'var(--bg-surface-hover)', text: 'var(--text-secondary)' }
                return (
                  <tr
                    key={bot.id}
                    style={{
                      backgroundColor: i % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-base)',
                      borderBottom: '1px solid var(--border-default)',
                      opacity: bot.botActive ? 1 : 0.6,
                    }}
                  >
                    {/* Name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold overflow-hidden"
                          style={{ backgroundColor: 'var(--color-teal-100)', color: 'var(--color-teal-700)' }}
                        >
                          {bot.avatarUrl
                            ? <img src={bot.avatarUrl} alt="" className="w-full h-full object-cover" />
                            : '🤖'
                          }
                        </div>
                        <div>
                          <Link
                            to={`/bots/${bot.id}`}
                            className="font-medium hover:underline"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {bot.displayName}
                          </Link>
                          {bot.botCalibrating && (
                            <span className="ml-1.5 text-xs px-1 py-0 rounded-full font-medium" style={{ backgroundColor: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}>calibrating</span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Owner */}
                    <td className="px-4 py-3 hidden sm:table-cell" style={{ color: 'var(--text-secondary)' }}>
                      {bot.owner ? (
                        <span className="text-sm">{bot.owner.displayName || bot.owner.username}</span>
                      ) : (
                        <span className="text-xs italic" style={{ color: 'var(--text-muted)' }}>built-in</span>
                      )}
                    </td>

                    {/* Algorithm */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span
                        className="text-xs font-medium px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: algoStyle.bg, color: algoStyle.text }}
                      >
                        {bot.botModelType}
                      </span>
                    </td>

                    {/* ELO */}
                    <td className="px-4 py-3 text-right font-mono font-semibold" style={{ color: 'var(--color-blue-600)' }}>
                      {Math.round(bot.eloRating)}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 text-center">
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: bot.botActive ? 'var(--color-teal-50)' : 'var(--color-gray-100)',
                          color: bot.botActive ? 'var(--color-teal-600)' : 'var(--text-muted)',
                        }}
                      >
                        {bot.botActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 justify-end">
                        <button
                          onClick={() => toggleActive(bot)}
                          className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)]"
                          style={{
                            borderColor: bot.botActive ? 'var(--color-orange-300)' : 'var(--color-teal-300)',
                            color: bot.botActive ? 'var(--color-orange-600)' : 'var(--color-teal-600)',
                          }}
                        >
                          {bot.botActive ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => deleteBot(bot)}
                          className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--color-red-50)]"
                          style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
                          title="Delete bot"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && bots.length === 0 && !error && (
        <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>No bots found.</p>
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
