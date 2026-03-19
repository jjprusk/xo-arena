import React, { useEffect, useState } from 'react'
import { api } from '../lib/api.js'

const PODIUM_COLORS = {
  0: { bg: 'var(--color-amber-100)', border: 'var(--color-amber-500)', label: '👑' },
  1: { bg: 'var(--color-gray-100)', border: 'var(--color-gray-400)', label: '🥈' },
  2: { bg: 'var(--color-amber-50)', border: 'var(--color-amber-600)', label: '🥉' },
}

const FILTERS_PERIOD = ['all', 'monthly', 'weekly']
const FILTERS_MODE = ['all', 'pvp', 'pvai']

export default function LeaderboardPage() {
  const [board, setBoard] = useState([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('all')
  const [mode, setMode] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    setLoading(true)
    api.get(`/leaderboard?period=${period}&mode=${mode}`)
      .then((res) => setBoard(res.leaderboard || []))
      .catch(() => setBoard([]))
      .finally(() => setLoading(false))
  }, [period, mode])

  const filtered = board.filter((e) =>
    !search || e.user.displayName.toLowerCase().includes(search.toLowerCase())
  )

  const top3 = filtered.slice(0, 3)

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <PageHeader title="Leaderboard" />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <FilterGroup label="Period" options={FILTERS_PERIOD} value={period} onChange={setPeriod} />
        <FilterGroup label="Mode" options={FILTERS_MODE} value={mode} onChange={setMode} />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search player…"
          className="px-3 py-1.5 rounded-lg border text-sm outline-none focus:border-[var(--color-blue-600)] transition-colors"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
            color: 'var(--text-primary)',
            boxShadow: 'var(--shadow-sm)',
          }}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
          No players yet. Play some games!
        </p>
      ) : (
        <>
          {/* Podium */}
          {top3.length > 0 && (
            <div className="flex items-end justify-center gap-4 py-2">
              {[top3[1], top3[0], top3[2]].filter(Boolean).map((entry) => {
                const rank = entry.rank - 1
                const isFirst = rank === 0
                return (
                  <div
                    key={entry.user.id}
                    className={`flex flex-col items-center gap-2 rounded-xl border-2 px-4 py-3 transition-transform ${isFirst ? 'pb-6 scale-105' : ''}`}
                    style={{
                      backgroundColor: PODIUM_COLORS[rank]?.bg || 'var(--bg-surface)',
                      borderColor: PODIUM_COLORS[rank]?.border || 'var(--border-default)',
                      boxShadow: 'var(--shadow-card)',
                      minWidth: 100,
                    }}
                  >
                    <span className="text-2xl">{PODIUM_COLORS[rank]?.label}</span>
                    <Avatar user={entry.user} size={isFirst ? 'lg' : 'md'} />
                    <span className="text-sm font-semibold text-center max-w-[90px] truncate">
                      {entry.user.displayName}
                    </span>
                    <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--color-teal-600)' }}>
                      {Math.round(entry.winRate * 100)}%
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Table */}
          <div
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-surface-hover)' }}>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Player</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide hidden sm:table-cell" style={{ color: 'var(--text-muted)' }}>Games</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide hidden sm:table-cell" style={{ color: 'var(--text-muted)' }}>Wins</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr
                    key={entry.user.id}
                    className="border-t transition-colors hover:bg-[var(--bg-surface-hover)]"
                    style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                  >
                    <td className="px-4 py-3 font-mono text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                      {entry.rank}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar user={entry.user} size="sm" />
                        <span className="font-medium truncate max-w-[120px]">{entry.user.displayName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                      {entry.total}
                    </td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                      {entry.wins}
                    </td>
                    <td className="px-4 py-3">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Avatar({ user, size = 'md' }) {
  const dim = size === 'lg' ? 48 : size === 'md' ? 36 : 24
  const textSize = size === 'lg' ? 'text-xl' : size === 'md' ? 'text-sm' : 'text-xs'
  return (
    <div
      className={`rounded-full flex items-center justify-center font-bold ${textSize} flex-shrink-0`}
      style={{ width: dim, height: dim, backgroundColor: 'var(--color-blue-100)', color: 'var(--color-blue-700)' }}
    >
      {user.avatarUrl
        ? <img src={user.avatarUrl} alt={user.displayName} className="w-full h-full rounded-full object-cover" />
        : user.displayName?.[0]?.toUpperCase() || '?'
      }
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
