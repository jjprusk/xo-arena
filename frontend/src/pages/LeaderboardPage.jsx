// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, cachedFetch } from '../lib/api.js'
import {
  ListTable, ListTh, ListTd, ListTr,
  UserAvatar, SearchBar,
} from '../components/ui/ListTable.jsx'
import { LeaderboardSkeleton } from '../components/ui/Skeleton.jsx'

const PODIUM_COLORS = {
  0: { bg: 'var(--color-amber-100)', border: 'var(--color-amber-500)', label: '👑' },
  1: { bg: 'var(--color-gray-100)', border: 'var(--color-gray-400)', label: '🥈' },
  2: { bg: 'var(--color-amber-50)', border: 'var(--color-amber-600)', label: '🥉' },
}

const FILTERS_PERIOD = ['all', 'monthly', 'weekly']
const FILTERS_MODE = ['all', 'pvp', 'pvai']
const LS_SHOW_BOTS = 'xo-leaderboard-show-bots'

export default function LeaderboardPage() {
  const [board, setBoard] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [justUpdated, setJustUpdated] = useState(false)
  const [period, setPeriod] = useState('all')
  const [mode, setMode] = useState('all')
  const [search, setSearch] = useState('')
  const [showBots, setShowBots] = useState(() => {
    try { return localStorage.getItem(LS_SHOW_BOTS) === 'true' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem(LS_SHOW_BOTS, showBots) } catch {}
  }, [showBots])

  useEffect(() => {
    let cancelled = false
    const path = `/leaderboard?period=${period}&mode=${mode}&includeBots=${showBots}`
    const { immediate, refresh } = cachedFetch(path, 5 * 60_000)
    if (immediate) {
      setBoard(immediate.leaderboard || [])
      setLoading(false)
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    refresh
      .then(res => {
        if (!cancelled) {
          setBoard(res.leaderboard || [])
          if (immediate) {
            setJustUpdated(true)
            setTimeout(() => { if (!cancelled) setJustUpdated(false) }, 2000)
          }
        }
      })
      .catch(() => { if (!cancelled && !immediate) setBoard([]) })
      .finally(() => { if (!cancelled) { setLoading(false); setRefreshing(false) } })
    return () => { cancelled = true }
  }, [period, mode, showBots])

  const filtered = board.filter((e) =>
    !search || e.user.displayName.toLowerCase().includes(search.toLowerCase())
  )

  const top3 = filtered.slice(0, 3)

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <PageHeader title="Leaderboard" />
        {refreshing && !justUpdated && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Refreshing…</span>
        )}
        {justUpdated && (
          <span className="text-xs" style={{ color: 'var(--color-teal-600)' }}>Updated</span>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <FilterGroup label="Period" options={FILTERS_PERIOD} value={period} onChange={setPeriod} />
        <FilterGroup label="Mode" options={FILTERS_MODE} value={mode} onChange={setMode} />
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search player…"
          className="w-44"
        />
        {/* Show bots toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Show bots</span>
          <button
            role="switch"
            aria-checked={showBots}
            onClick={() => setShowBots((v) => !v)}
            className="relative w-9 h-5 rounded-full transition-colors focus:outline-none focus-visible:ring-2"
            style={{ backgroundColor: showBots ? 'var(--color-blue-600)' : 'var(--color-gray-300)' }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
              style={{ transform: showBots ? 'translateX(16px)' : 'translateX(0)' }}
            />
          </button>
        </label>
      </div>

      {loading ? (
        <LeaderboardSkeleton />
      ) : filtered.length === 0 ? (
        <p className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
          No players yet. Play some games!
        </p>
      ) : (
        <>
          {/* Podium */}
          {top3.length > 0 && (
            <div className="flex items-end justify-center gap-2 sm:gap-4 py-2">
              {[top3[1], top3[0], top3[2]].filter(Boolean).map((entry) => {
                const rank = entry.rank - 1
                const isFirst = rank === 0
                return (
                  <Link
                    key={entry.user.id}
                    to={entry.user.isBot ? `/bots/${entry.user.id}` : '#'}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 sm:px-4 py-3 transition-transform no-underline flex-1 max-w-[120px] ${isFirst ? 'pb-6 scale-105' : ''}`}
                    style={{
                      backgroundColor: PODIUM_COLORS[rank]?.bg || 'var(--bg-surface)',
                      borderColor: PODIUM_COLORS[rank]?.border || 'var(--border-default)',
                      boxShadow: 'var(--shadow-card)',
                    }}
                  >
                    <span className="text-2xl">{PODIUM_COLORS[rank]?.label}</span>
                    <UserAvatar user={entry.user} size={isFirst ? 'lg' : 'md'} />
                    <div className="flex items-center gap-1">
                      {entry.user.isBot && <span title="Bot">🤖</span>}
                      <span className="text-sm font-semibold text-center max-w-[90px] truncate">
                        {entry.user.displayName}
                      </span>
                    </div>
                    <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--color-teal-600)' }}>
                      {Math.round(entry.winRate * 100)}%
                    </span>
                  </Link>
                )
              })}
            </div>
          )}

          {/* Table */}
          <ListTable maxHeight="clamp(200px, calc(100dvh - 420px), 800px)">
            <thead>
              <tr>
                <ListTh>#</ListTh>
                <ListTh>Player</ListTh>
                <ListTh align="right" className="hidden sm:table-cell">Games</ListTh>
                <ListTh align="right" className="hidden sm:table-cell">Wins</ListTh>
                <ListTh>Win Rate</ListTh>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, i) => (
                <ListTr key={entry.user.id} last={i === filtered.length - 1}>
                  <ListTd>
                    <span className="font-mono text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                      {entry.rank}
                    </span>
                  </ListTd>
                  <ListTd>
                    <div className="flex items-center gap-2.5">
                      <UserAvatar user={entry.user} size="sm" />
                      {entry.user.isBot ? (
                        <Link
                          to={`/bots/${entry.user.id}`}
                          className="flex items-center gap-1 font-medium truncate max-w-[120px] hover:underline"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          <span title="Bot">🤖</span>
                          {entry.user.displayName}
                        </Link>
                      ) : (
                        <span className="font-medium truncate max-w-[120px]">{entry.user.displayName}</span>
                      )}
                    </div>
                  </ListTd>
                  <ListTd align="right" className="hidden sm:table-cell">
                    <span className="tabular-nums">{entry.total}</span>
                  </ListTd>
                  <ListTd align="right" className="hidden sm:table-cell">
                    <span className="tabular-nums">{entry.wins}</span>
                  </ListTd>
                  <ListTd>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full max-w-[80px]" style={{ backgroundColor: 'var(--color-gray-200)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.round(entry.winRate * 100)}%`, backgroundColor: 'var(--color-teal-600)' }}
                        />
                      </div>
                      <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--color-teal-600)' }}>
                        {Math.round(entry.winRate * 100)}%
                      </span>
                    </div>
                  </ListTd>
                </ListTr>
              ))}
            </tbody>
          </ListTable>
        </>
      )}
    </div>
  )
}

function FilterGroup({ label, options, value, onChange }) {
  return (
    <div
      className="flex items-center rounded-lg border overflow-hidden"
      style={{ borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-sm)' }}
    >
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
            value === opt ? 'bg-[var(--color-blue-600)] text-white' : 'hover:bg-[var(--bg-surface-hover)]'
          }`}
          style={{ color: value === opt ? 'white' : 'var(--text-secondary)' }}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

function PageHeader({ title }) {
  return (
    <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
      <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>{title}</h1>
    </div>
  )
}
