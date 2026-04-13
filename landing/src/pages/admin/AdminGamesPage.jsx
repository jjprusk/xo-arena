// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api.js'
import { AdminHeader, Spinner, ErrorMsg } from './AdminDashboard.jsx'
import { getToken } from '../../lib/getToken.js'
import {
  ListTable, ListTh, ListTd, ListTr, ListPagination, SearchBar,
} from '../../components/ui/ListTable.jsx'

const LIMIT = 25

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
  const [playerFilter, setPlayerFilter]   = useState('')
  const [dateFrom, setDateFrom]           = useState('')
  const [dateTo, setDateTo]               = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [actionError, setActionError] = useState(null)

  const totalPages = Math.ceil(total / LIMIT)

  const load = useCallback(async (p, mode, outcome, player, from, to) => {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const filters = {}
      if (mode)    filters.mode     = mode
      if (outcome) filters.outcome  = outcome
      if (player)  filters.player   = player
      if (from)    filters.dateFrom = from
      if (to)      filters.dateTo   = to
      const { games: g, total: t } = await api.admin.games(token, p, LIMIT, filters)
      setGames(g)
      setTotal(t)
    } catch {
      setError('Failed to load games.')
    } finally {
      setLoading(false)
    }
  }, [])

  const [debouncedPlayer, setDebouncedPlayer] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebouncedPlayer(playerFilter), 300)
    return () => clearTimeout(id)
  }, [playerFilter])

  useEffect(() => { setPage(1) }, [modeFilter, outcomeFilter, debouncedPlayer, dateFrom, dateTo])
  useEffect(() => {
    load(page, modeFilter, outcomeFilter, debouncedPlayer, dateFrom, dateTo)
  }, [page, modeFilter, outcomeFilter, debouncedPlayer, dateFrom, dateTo, load])

  function handleSelectChange(setter) {
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

      <div className="flex gap-2 flex-wrap items-center">
        <SearchBar
          value={playerFilter}
          onChange={setPlayerFilter}
          placeholder="Search player…"
          className="w-48"
        />
        <select
          value={modeFilter}
          onChange={handleSelectChange(setModeFilter)}
          className="px-3 py-2 rounded-lg border text-sm focus:outline-none"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
        >
          <option value="">All modes</option>
          <option value="hva">HvA</option>
          <option value="hvh">HvH</option>
          <option value="hvb">HvB</option>
          <option value="bvb">BvB</option>
        </select>
        <select
          value={outcomeFilter}
          onChange={handleSelectChange(setOutcomeFilter)}
          className="px-3 py-2 rounded-lg border text-sm focus:outline-none"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
        >
          <option value="">All outcomes</option>
          <option value="player1_win">P1 Win</option>
          <option value="ai_win">AI Win</option>
          <option value="draw">Draw</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className="px-3 py-2 rounded-lg border text-sm focus:outline-none"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          title="From date"
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          min={dateFrom || undefined}
          className="px-3 py-2 rounded-lg border text-sm focus:outline-none"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          title="To date"
        />
        {(playerFilter || modeFilter || outcomeFilter || dateFrom || dateTo) && (
          <button
            onClick={() => { setPlayerFilter(''); setModeFilter(''); setOutcomeFilter(''); setDateFrom(''); setDateTo('') }}
            className="px-3 py-2 rounded-lg border text-sm transition-colors hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
          >
            Clear filters
          </button>
        )}
      </div>

      {actionError && <ErrorMsg>{actionError}</ErrorMsg>}
      {loading && <Spinner />}
      {error && <ErrorMsg>{error}</ErrorMsg>}

      {!loading && (
        <ListTable maxHeight="65vh">
          <thead>
            <tr>
              <ListTh>Player(s)</ListTh>
              <ListTh className="hidden md:table-cell">Mode</ListTh>
              <ListTh>Outcome</ListTh>
              <ListTh align="right" className="hidden lg:table-cell">Moves</ListTh>
              <ListTh align="right" className="hidden lg:table-cell">Duration</ListTh>
              <ListTh className="hidden md:table-cell">Date</ListTh>
              <ListTh>ID</ListTh>
              <ListTh />
            </tr>
          </thead>
          <tbody>
            {games.map((g, i) => (
              <ListTr key={g.id} last={i === games.length - 1}>
                <ListTd>
                  <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                    {g.player1?.displayName ?? '—'}
                  </div>
                  {g.player2 && (
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      vs {g.player2.displayName}
                    </div>
                  )}
                  {!g.player2 && g.mode === 'HVA' && (
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      vs AI {g.difficulty ? `(${g.difficulty.toLowerCase()})` : ''}
                    </div>
                  )}
                </ListTd>
                <ListTd className="hidden md:table-cell">
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    {g.mode === 'HVA' ? 'HvA' : g.mode === 'HVH' ? 'HvH' : g.mode === 'HVB' ? 'HvB' : g.mode === 'BVB' ? 'BvB' : g.mode}
                  </span>
                </ListTd>
                <ListTd>
                  <span
                    className="text-xs font-semibold px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${OUTCOME_COLOR[g.outcome]} 12%, transparent)`,
                      color: OUTCOME_COLOR[g.outcome],
                    }}
                  >
                    {OUTCOME_LABEL[g.outcome] ?? g.outcome}
                  </span>
                </ListTd>
                <ListTd align="right" className="hidden lg:table-cell">
                  <span className="tabular-nums">{g.totalMoves}</span>
                </ListTd>
                <ListTd align="right" className="hidden lg:table-cell">
                  <span className="tabular-nums">{(g.durationMs / 1000).toFixed(1)}s</span>
                </ListTd>
                <ListTd className="hidden md:table-cell">
                  <span className="text-xs">{new Date(g.endedAt).toLocaleDateString()}</span>
                </ListTd>
                <ListTd>
                  <span
                    className="text-xs font-mono select-all cursor-text"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {g.id}
                  </span>
                </ListTd>
                <ListTd align="right">
                  <button
                    onClick={() => deleteGame(g.id)}
                    className="text-xs px-2 py-0.5 rounded border hover:bg-[var(--color-red-50)] hover:text-[var(--color-red-600)] hover:border-[var(--color-red-300)] transition-colors"
                    style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
                    title="Delete game"
                  >
                    ✕
                  </button>
                </ListTd>
              </ListTr>
            ))}
          </tbody>
        </ListTable>
      )}

      {!loading && games.length === 0 && !error && (
        <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>No games found.</p>
      )}

      <ListPagination
        page={page}
        totalPages={totalPages}
        total={total}
        limit={LIMIT}
        onPageChange={setPage}
        noun="games"
      />
    </div>
  )
}
