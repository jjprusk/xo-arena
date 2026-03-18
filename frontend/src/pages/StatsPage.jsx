import React, { useEffect, useState } from 'react'
import { api } from '../lib/api.js'

const DEMO_STATS = {
  totalGames: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  winRate: 0,
  pvp: { played: 0, wins: 0, rate: 0 },
  pvai: {
    easy: { played: 0, wins: 0, rate: 0 },
    medium: { played: 0, wins: 0, rate: 0 },
    hard: { played: 0, wins: 0, rate: 0 },
  },
  recentGames: [],
}

const OUTCOME_COLOR = {
  win: 'var(--color-teal-600)',
  loss: 'var(--color-red-600)',
  draw: 'var(--color-amber-600)',
}

export default function StatsPage() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)

  // When auth is wired, fetch real stats. For now show placeholder.
  useEffect(() => {
    setStats(DEMO_STATS)
  }, [])

  if (loading || !stats) {
    return (
      <div className="max-w-lg mx-auto flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
        Stats
      </h1>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total Games" value={stats.totalGames} />
        <StatCard
          label="Win Rate"
          value={`${Math.round(stats.winRate * 100)}%`}
          color="var(--color-teal-600)"
        />
        <StatCard label="Wins" value={stats.wins} color="var(--color-teal-600)" />
        <StatCard label="Draws" value={stats.draws} color="var(--color-amber-600)" />
      </div>

      {/* Win rate by mode */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>
          Win Rate by Mode
        </h2>
        <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}>
          <WinRateBar label="PvP" rate={stats.pvp.rate} color="var(--color-blue-600)" />
          <WinRateBar label="AI — Easy" rate={stats.pvai.easy.rate} color="var(--color-teal-600)" />
          <WinRateBar label="AI — Medium" rate={stats.pvai.medium.rate} color="var(--color-teal-600)" />
          <WinRateBar label="AI — Hard" rate={stats.pvai.hard.rate} color="var(--color-teal-600)" />
        </div>
      </section>

      {/* Recent games streak grid */}
      {stats.recentGames.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>
            Last {stats.recentGames.length} Games
          </h2>
          <div className="flex gap-1.5 flex-wrap">
            {stats.recentGames.map((g, i) => {
              const result = g.winnerId === 'me' ? 'win' : g.outcome === 'DRAW' ? 'draw' : 'loss'
              return (
                <div
                  key={i}
                  title={result}
                  className="w-4 h-4 rounded-sm"
                  style={{ backgroundColor: OUTCOME_COLOR[result] }}
                />
              )
            })}
          </div>
        </section>
      )}

      {/* Auth prompt */}
      <div className="rounded-xl border p-4 text-center" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Sign in to track stats across sessions.
        </p>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}>
      <div className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: color || 'var(--text-primary)' }}>
        {value}
      </div>
      <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

function WinRateBar({ label, rate, color }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ color: 'var(--text-secondary)' }}>{Math.round(rate * 100)}%</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-gray-100)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.round(rate * 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}
