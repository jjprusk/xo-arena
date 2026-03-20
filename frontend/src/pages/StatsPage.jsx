import React, { useEffect, useState } from 'react'
import { useUser } from '@clerk/clerk-react'
import { api } from '../lib/api.js'

const OUTCOME_COLOR = {
  win: 'var(--color-teal-600)',
  loss: 'var(--color-red-600)',
  draw: 'var(--color-amber-600)',
}

export default function StatsPage() {
  const { isSignedIn, isLoaded } = useUser()
  const [stats, setStats] = useState(null)
  const [dbUserId, setDbUserId] = useState(null)
  const [eloData, setEloData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) {
      setStats(null)
      return
    }

    setLoading(true)
    setError(null)

    async function load() {
      try {
        const token = await window.Clerk?.session?.getToken()
        const { user } = await api.users.sync(token)
        setDbUserId(user.id)
        const [{ stats: s }, eloRes] = await Promise.all([
          api.users.stats(user.id),
          api.users.eloHistory(user.id).catch(() => null),
        ])
        setStats(s)
        if (eloRes) setEloData(eloRes)
      } catch (err) {
        setError('Failed to load stats.')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [isSignedIn, isLoaded])

  if (!isLoaded || loading) {
    return (
      <div className="max-w-lg mx-auto flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!isSignedIn) {
    return (
      <div className="max-w-lg mx-auto space-y-8">
        <PageHeader title="Stats" />
        <div
          className="rounded-xl border p-8 text-center"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
        >
          <p className="text-lg font-semibold mb-2">Sign in to see your stats</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Your wins, losses, and game history are tracked across sessions once you sign in.
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto space-y-8">
        <PageHeader title="Stats" />
        <p className="text-sm text-center" style={{ color: 'var(--color-red-600)' }}>{error}</p>
      </div>
    )
  }

  if (!stats) return null

  const noGamesYet = stats.totalGames === 0

  return (
    <div className="max-w-lg mx-auto space-y-8">
      <PageHeader title="Stats" />

      {noGamesYet ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
        >
          <p className="text-lg font-semibold mb-2">No games yet</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Play a game to start tracking your stats.
          </p>
        </div>
      ) : (
        <>
          {/* ELO + stats grid */}
          <div className="grid grid-cols-2 gap-3">
            {eloData && (
              <div
                className="col-span-2 rounded-xl border p-5 flex items-center justify-between"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
              >
                <div>
                  <div className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-blue-600)' }}>
                    {Math.round(eloData.currentElo)}
                  </div>
                  <div className="text-xs mt-1 font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>ELO Rating</div>
                </div>
                {eloData.eloHistory.length > 0 && (
                  <div className="text-right">
                    <div
                      className="text-sm font-semibold"
                      style={{ color: eloData.eloHistory[0].delta >= 0 ? 'var(--color-teal-600)' : 'var(--color-red-600)' }}
                    >
                      {eloData.eloHistory[0].delta >= 0 ? '+' : ''}{Math.round(eloData.eloHistory[0].delta)} last game
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {eloData.eloHistory.length} rated game{eloData.eloHistory.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                )}
              </div>
            )}
            <StatCard label="Total Games" value={stats.totalGames} />
            <StatCard label="Win Rate" value={`${Math.round(stats.winRate * 100)}%`} color="var(--color-teal-600)" />
            <StatCard label="Wins" value={stats.wins} color="var(--color-teal-600)" />
            <StatCard label="Draws" value={stats.draws} color="var(--color-amber-600)" />
          </div>

          {/* Win rate by mode */}
          <section className="space-y-3">
            <SectionLabel>Win Rate by Mode</SectionLabel>
            <div
              className="rounded-xl border p-5 space-y-4"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
            >
              <WinRateBar label="PvP" rate={stats.pvp.rate} color="var(--color-blue-600)" />
              <WinRateBar label="AI — Easy" rate={stats.pvai.easy.rate} color="var(--color-teal-600)" />
              <WinRateBar label="AI — Medium" rate={stats.pvai.medium.rate} color="var(--color-teal-600)" />
              <WinRateBar label="AI — Hard" rate={stats.pvai.hard.rate} color="var(--color-teal-600)" />
            </div>
          </section>

          {/* Recent games */}
          {stats.recentGames.length > 0 && (
            <section className="space-y-3">
              <SectionLabel>Last {stats.recentGames.length} Games</SectionLabel>
              <div className="flex gap-1.5 flex-wrap">
                {stats.recentGames.map((g, i) => {
                  const isWin = g.winnerId === dbUserId
                  const result = g.outcome === 'DRAW' ? 'draw' : isWin ? 'win' : 'loss'
                  return (
                    <div
                      key={i}
                      title={`${result} · ${g.mode === 'PVP' ? 'PvP' : `vs AI (${g.difficulty?.toLowerCase()})`}`}
                      className="w-5 h-5 rounded"
                      style={{ backgroundColor: OUTCOME_COLOR[result] }}
                    />
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)', color: color || 'var(--text-primary)' }}>
        {value}
      </div>
      <div className="text-xs mt-1.5 font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

function WinRateBar({ label, rate, color }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="font-semibold tabular-nums" style={{ color }}>{Math.round(rate * 100)}%</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-gray-100)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.round(rate * 100)}%`, backgroundColor: color }}
        />
      </div>
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

function SectionLabel({ children }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
      {children}
    </h2>
  )
}
