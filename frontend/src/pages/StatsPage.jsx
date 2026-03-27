import React, { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useSession } from '../lib/auth-client.js'
import { getToken } from '../lib/getToken.js'
import { api } from '../lib/api.js'

const OUTCOME_COLOR = {
  win: 'var(--color-teal-600)',
  loss: 'var(--color-red-600)',
  draw: 'var(--color-amber-600)',
}

export default function StatsPage() {
  const location = useLocation()
  const { data: session, isPending } = useSession()
  const isLoaded = !isPending
  const isSignedIn = !!session?.user
  const user = session?.user ?? null
  const displayName = user?.name || user?.username || 'You'
  const [stats, setStats] = useState(null)
  const [dbUserId, setDbUserId] = useState(null)
  const [eloData, setEloData] = useState(null)
  const [mlProfiles, setMlProfiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [expandedProfile, setExpandedProfile] = useState(null)

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
        const token = await getToken()
        const { user } = await api.users.sync(token)
        setDbUserId(user.id)
        const [{ stats: s }, eloRes, mlRes] = await Promise.all([
          api.users.stats(user.id),
          api.users.eloHistory(user.id).catch(() => null),
          api.users.mlProfiles(user.id, token).catch(() => null),
        ])
        setStats(s)
        if (eloRes) setEloData(eloRes)
        if (mlRes?.profiles?.length) setMlProfiles(mlRes.profiles)
      } catch (err) {
        setError('Failed to load stats.')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [isSignedIn, isLoaded, location.key])

  if (!isLoaded || loading) {
    return (
      <div className="max-w-lg mx-auto flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!isSignedIn) {
    return (
      <div className="max-w-lg mx-auto space-y-6">
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
      <div className="max-w-lg mx-auto space-y-6">
        <PageHeader title="Stats" />
        <p className="text-sm text-center" style={{ color: 'var(--color-red-600)' }}>{error}</p>
      </div>
    )
  }

  if (!stats) return null

  const noGamesYet = stats.totalGames === 0

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <PageHeader title="Stats" eloData={eloData} />

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
          {/* Stats strip */}
          <div
            className="rounded-xl border px-4 py-3 grid grid-cols-4 divide-x"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)', divideColor: 'var(--border-default)' }}
          >
            <MiniStat label="Games" value={stats.totalGames} />
            <MiniStat label="Win %" value={`${Math.round(stats.winRate * 100)}%`} color="var(--color-teal-600)" />
            <MiniStat label="Wins" value={stats.wins} color="var(--color-teal-600)" />
            <MiniStat label="Draws" value={stats.draws} color="var(--color-amber-600)" />
          </div>

          {/* Win rate by mode + recent games side by side on wider screens */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <section className="space-y-2">
              <SectionLabel>Win Rate by Mode</SectionLabel>
              <div
                className="rounded-xl border p-4 space-y-3"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
              >
                <WinRateBar label="PvP" rate={stats.pvp.rate} color="var(--color-blue-600)" />
                <WinRateBar label="Novice AI" rate={stats.pvai.novice.rate} color="var(--color-teal-600)" />
                <WinRateBar label="Intermediate AI" rate={stats.pvai.intermediate.rate} color="var(--color-teal-600)" />
                <WinRateBar label="Advanced AI" rate={stats.pvai.advanced.rate} color="var(--color-teal-600)" />
                <WinRateBar label="Master AI" rate={stats.pvai.master.rate} color="var(--color-teal-600)" />
                {stats.pvbot?.played > 0 && (
                  <WinRateBar label="vs Bots" rate={stats.pvbot.rate} color="#9333ea" />
                )}
              </div>
            </section>

            {stats.recentGames.length > 0 && (
              <section className="space-y-2">
                <SectionLabel>Last {stats.recentGames.length} Games</SectionLabel>
                <div
                  className="rounded-xl border p-4"
                  style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
                >
                  <div className="flex gap-1 flex-wrap">
                    {stats.recentGames.map((g, i) => {
                      const isWin = g.winnerId === dbUserId
                      const result = g.outcome === 'DRAW' ? 'draw' : isWin ? 'win' : 'loss'
                      return (
                        <div
                          key={i}
                          title={`${result} · ${g.mode === 'PVP' ? 'PvP' : g.mode === 'PVBOT' ? `vs ${g.player2?.displayName ?? 'Bot'}` : `vs AI (${g.difficulty?.toLowerCase()})`}`}
                          className="w-4 h-4 rounded-sm"
                          style={{ backgroundColor: OUTCOME_COLOR[result] }}
                        />
                      )
                    })}
                  </div>
                  <div className="flex gap-3 mt-3">
                    {[['win', 'W'], ['loss', 'L'], ['draw', 'D']].map(([key, label]) => (
                      <span key={key} className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                        <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: OUTCOME_COLOR[key] }} />
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </div>

          {/* PvBot breakdown */}
          {stats.pvbot?.played > 0 && (
            <section className="space-y-2">
              <SectionLabel>Bot Challenges</SectionLabel>
              <div
                className="rounded-xl border divide-y"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)', divideColor: 'var(--border-default)' }}
              >
                {Object.values(stats.pvbot.byBot).map((entry) => (
                  <div key={entry.bot.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2">
                      {entry.bot.avatarUrl && (
                        <img src={entry.bot.avatarUrl} alt="" className="w-6 h-6 rounded-full" />
                      )}
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {entry.bot.displayName ?? 'Bot'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      <span>{entry.played} game{entry.played !== 1 ? 's' : ''}</span>
                      <span style={{ color: '#9333ea', fontWeight: 600 }}>{Math.round(entry.rate * 100)}% win</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ML behavior profiles */}
          {mlProfiles.length > 0 && (
            <section className="space-y-2">
              <SectionLabel>AI Behavior Profiles</SectionLabel>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                How the ML models have learned to read your play style.
              </p>
              <div className="space-y-2">
                {mlProfiles.map(p => {
                  const tendencies = p.tendencies || {}
                  const isExpanded = expandedProfile === p.id
                  return (
                    <div key={p.id} className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
                      <button
                        onClick={() => setExpandedProfile(prev => prev === p.id ? null : p.id)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-[var(--bg-surface-hover)]"
                        style={{ backgroundColor: 'var(--bg-surface)' }}
                      >
                        <div>
                          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {displayName}
                          </div>
                          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            vs {p.model?.name ?? 'Unknown model'} · {p.gamesRecorded} game{p.gamesRecorded !== 1 ? 's' : ''} · updated {new Date(p.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-4">
                          <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                            Center {Math.round((tendencies.centerRate || 0) * 100)}% · Corner {Math.round((tendencies.cornerRate || 0) * 100)}%
                          </span>
                          <span style={{ color: 'var(--text-muted)' }}>{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-4 py-4 border-t flex flex-wrap gap-8 items-start" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
                          <div>
                            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Opening Preferences</p>
                            {Object.keys(p.openingPreferences || {}).length > 0
                              ? <MiniBoard counts={p.openingPreferences} />
                              : <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No opening data yet</p>
                            }
                          </div>
                          <div className="flex-1 min-w-[160px] space-y-2">
                            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Move Tendencies</p>
                            <TendencyBar label="Center rate" value={tendencies.centerRate} />
                            <TendencyBar label="Corner rate" value={tendencies.cornerRate} />
                          </div>
                        </div>
                      )}
                    </div>
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

function MiniStat({ label, value, color }) {
  return (
    <div className="px-3 text-center first:pl-0 last:pr-0">
      <div className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)', color: color || 'var(--text-primary)' }}>
        {value}
      </div>
      <div className="text-[10px] mt-0.5 font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

function WinRateBar({ label, rate, color }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="font-semibold tabular-nums" style={{ color }}>{Math.round(rate * 100)}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-gray-100)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.round(rate * 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

function PageHeader({ title, eloData }) {
  return (
    <div className="pb-4 border-b flex items-end justify-between" style={{ borderColor: 'var(--border-default)' }}>
      <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>{title}</h1>
      {eloData && (
        <div className="text-right pb-0.5">
          <div className="text-2xl font-bold tabular-nums" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-blue-600)' }}>
            {Math.round(eloData.currentElo)}
          </div>
          <div className="flex items-center gap-1.5 justify-end">
            <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>ELO</span>
            {eloData.eloHistory.length > 0 && (
              <span
                className="text-[10px] font-semibold tabular-nums"
                style={{ color: eloData.eloHistory[0].delta >= 0 ? 'var(--color-teal-600)' : 'var(--color-red-600)' }}
              >
                {eloData.eloHistory[0].delta >= 0 ? '+' : ''}{Math.round(eloData.eloHistory[0].delta)}
              </span>
            )}
          </div>
        </div>
      )}
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

function MiniBoard({ counts }) {
  const values = Array.from({ length: 9 }, (_, i) => Number(counts[i] || 0))
  const maxVal = Math.max(...values, 1)
  return (
    <div className="grid grid-cols-3 gap-0.5 w-[90px]">
      {values.map((v, i) => {
        const intensity = v / maxVal
        const alpha = 0.1 + intensity * 0.9
        return (
          <div
            key={i}
            className="aspect-square flex items-center justify-center rounded text-[10px] font-bold"
            style={{ backgroundColor: `rgba(59,130,246,${alpha})`, color: intensity > 0.5 ? '#fff' : 'var(--text-muted)' }}
          >
            {v > 0 ? v : ''}
          </div>
        )
      })}
    </div>
  )
}

function TendencyBar({ label, value }) {
  const pct = Math.round((value || 0) * 100)
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5" style={{ color: 'var(--text-secondary)' }}>
        <span>{label}</span>
        <span className="font-mono font-semibold">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-gray-200)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--color-blue-600)' }} />
      </div>
    </div>
  )
}
