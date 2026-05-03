// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api.js'
import { AdminHeader, Spinner, ErrorMsg } from './AdminDashboard.jsx'
import { getToken } from '../../lib/getToken.js'
import {
  ListTable, ListTh, ListTd, ListTr,
  SearchBar, ListPagination,
} from '../../components/ui/ListTable.jsx'

const LIMIT = 25
const ALGO_COLORS = {
  minimax:    { bg: 'var(--color-blue-50)',   text: 'var(--color-blue-700)'   },
  ml:         { bg: 'var(--color-teal-50)',   text: 'var(--color-teal-700)'   },
  mcts:       { bg: 'var(--color-purple-50)', text: 'var(--color-purple-700)' },
  rule_based: { bg: 'var(--color-amber-50)',  text: 'var(--color-amber-700)'  },
}

export default function AdminBotsPage() {
  const [bots, setBots]       = useState([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [search, setSearch]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [actionError, setActionError] = useState(null)

  const [sgBot1, setSgBot1] = useState('')
  const [sgBot2, setSgBot2] = useState('')
  const [sgStarting, setSgStarting] = useState(false)
  const [sgResult, setSgResult] = useState(null)
  const [sgError, setSgError] = useState(null)

  const [aivaiMaxGames, setAivaiMaxGamesLocal] = useState(5)
  const [aivaiSaving, setAivaiSaving] = useState(false)
  const [aivaiSaved, setAivaiSaved] = useState(false)

  const totalPages = Math.ceil(total / LIMIT)

  useEffect(() => {
    getToken().then(token => api.admin.getAivaiConfig(token).then(d => setAivaiMaxGamesLocal(d.maxGames)).catch(() => {}))
  }, [])

  async function saveAivaiConfig() {
    setAivaiSaving(true)
    setAivaiSaved(false)
    try {
      const token = await getToken()
      const { maxGames } = await api.admin.setAivaiConfig({ maxGames: aivaiMaxGames }, token)
      setAivaiMaxGamesLocal(maxGames)
      setAivaiSaved(true)
      setTimeout(() => setAivaiSaved(false), 2000)
    } catch {
      // ignore
    } finally {
      setAivaiSaving(false)
    }
  }

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

  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(id)
  }, [search])
  useEffect(() => { setPage(1) }, [debouncedSearch])
  useEffect(() => { load(debouncedSearch, page) }, [debouncedSearch, page, load])

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

  async function toggleAvailable(bot) {
    setActionError(null)
    try {
      const token = await getToken()
      const { bot: updated } = await api.admin.updateBot(bot.id, { botAvailable: !bot.botAvailable }, token)
      setBots(prev => prev.map(b => b.id === bot.id ? { ...b, botAvailable: updated.botAvailable } : b))
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
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Bot 1 (X)</label>
            <select
              value={sgBot1}
              onChange={e => setSgBot1(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg border text-sm"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
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
              className="w-full px-2 py-1.5 rounded-lg border text-sm"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
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
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
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
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: 'var(--color-blue-600)' }}
            >
              spectate
            </a>
          </p>
        )}
      </div>

      {/* Aivai config */}
      <div
        className="rounded-xl border p-4 space-y-3"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">⚙️</span>
          <span className="text-sm font-semibold">Bot vs Bot Challenge Settings</span>
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Max games per challenge
            </label>
            <input
              type="number"
              min={1}
              max={99}
              value={aivaiMaxGames}
              onChange={e => setAivaiMaxGamesLocal(Math.max(1, parseInt(e.target.value) || 1))}
              className="px-2 py-1.5 rounded-lg border text-sm w-24"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
            />
          </div>
          <button
            onClick={saveAivaiConfig}
            disabled={aivaiSaving}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
          >
            {aivaiSaving ? 'Saving…' : aivaiSaved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          When this limit is reached without a series winner, the challenge stops automatically.
        </p>
      </div>

      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search by name…"
      />

      {actionError && <ErrorMsg>{actionError}</ErrorMsg>}
      {loading && <Spinner />}
      {error && <ErrorMsg>{error}</ErrorMsg>}

      {!loading && (
        <ListTable maxHeight="60vh">
          <thead>
            <tr>
              <ListTh>Name</ListTh>
              <ListTh className="hidden sm:table-cell">Owner</ListTh>
              <ListTh className="hidden md:table-cell">Algorithm</ListTh>
              <ListTh className="hidden lg:table-cell">Skills</ListTh>
              <ListTh align="right">ELO</ListTh>
              <ListTh align="center">Status</ListTh>
              <ListTh align="center" className="hidden lg:table-cell">Available</ListTh>
              <ListTh />
            </tr>
          </thead>
          <tbody>
            {bots.map((bot, i) => {
              const algoStyle = ALGO_COLORS[bot.botModelType] ?? { bg: 'var(--color-gray-100)', text: 'var(--text-muted)' }
              return (
                <ListTr key={bot.id} dimmed={!bot.botActive} last={i === bots.length - 1}>

                  <ListTd>
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
                        <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                          {bot.displayName}
                        </span>
                        {bot.botProvisional && (
                          <span className="ml-1.5 text-[10px] px-1 py-0 rounded-full font-medium" style={{ backgroundColor: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}>
                            calibrating
                          </span>
                        )}
                      </div>
                    </div>
                  </ListTd>

                  <ListTd className="hidden sm:table-cell">
                    {bot.owner ? (
                      <span className="text-xs">{bot.owner.displayName || bot.owner.username}</span>
                    ) : (
                      <span className="text-xs italic" style={{ color: 'var(--text-muted)' }}>built-in</span>
                    )}
                  </ListTd>

                  <ListTd className="hidden md:table-cell">
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: algoStyle.bg, color: algoStyle.text }}
                    >
                      {bot.botModelType}
                    </span>
                  </ListTd>

                  <ListTd className="hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {(bot.skills ?? []).length === 0 ? (
                        <span className="text-[10px] italic" style={{ color: 'var(--text-muted)' }}>none</span>
                      ) : (bot.skills ?? []).map(s => (
                        <span
                          key={s.gameId}
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                          title={`${s.gameId}: ${s.algorithm} — ${s.status}`}
                          style={{ backgroundColor: 'var(--color-teal-50)', color: 'var(--color-teal-700)' }}
                        >
                          {s.gameId.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </ListTd>

                  <ListTd align="right">
                    <span className="font-mono font-semibold text-xs tabular-nums" style={{ color: 'var(--color-blue-600)' }}>
                      {Math.round(bot.eloRating)}
                    </span>
                  </ListTd>

                  <ListTd align="center">
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: bot.botActive ? 'var(--color-teal-50)' : 'var(--color-gray-100)',
                        color: bot.botActive ? 'var(--color-teal-600)' : 'var(--text-muted)',
                      }}
                    >
                      {bot.botActive ? 'Active' : 'Inactive'}
                    </span>
                  </ListTd>

                  <ListTd align="center" className="hidden lg:table-cell">
                    <button
                      onClick={() => toggleAvailable(bot)}
                      disabled={bot.botInTournament}
                      className="text-[10px] px-2 py-0.5 rounded-full font-semibold border transition-colors hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: bot.botAvailable ? 'var(--color-blue-50)' : 'var(--color-gray-100)',
                        color: bot.botAvailable ? 'var(--color-blue-600)' : 'var(--text-muted)',
                        borderColor: bot.botAvailable ? 'var(--color-blue-200)' : 'var(--border-default)',
                      }}
                      title={bot.botInTournament ? 'In tournament — cannot change' : 'Toggle tournament availability'}
                    >
                      {bot.botAvailable ? 'Yes' : 'No'}
                    </button>
                  </ListTd>

                  <ListTd align="right">
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
                        className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--color-red-50)] hover:text-[var(--color-red-600)]"
                        style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
                        title="Delete bot"
                      >
                        ✕
                      </button>
                    </div>
                  </ListTd>
                </ListTr>
              )
            })}
          </tbody>
        </ListTable>
      )}

      {!loading && bots.length === 0 && !error && (
        <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>No bots found.</p>
      )}

      <ListPagination
        page={page}
        totalPages={totalPages}
        total={total}
        limit={LIMIT}
        onPageChange={setPage}
        noun="bots"
      />
    </div>
  )
}
