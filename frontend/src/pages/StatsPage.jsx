import React, { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { getToken } from '../lib/getToken.js'
import { api } from '../lib/api.js'
import { StatsSkeleton } from '../components/ui/Skeleton.jsx'
import { ListTable, ListTh, ListTr, ListTd } from '../components/ui/ListTable.jsx'

const AI_NAMES = {
  novice:       'Rusty',
  intermediate: 'Copper',
  advanced:     'Sterling',
  master:       'Magnus',
}

const OUTCOME_COLOR = {
  win: 'var(--color-teal-600)',
  loss: 'var(--color-red-600)',
  draw: 'var(--color-amber-600)',
}

export default function StatsPage() {
  const location = useLocation()
  const { data: session, isPending } = useOptimisticSession()
  const user = session?.user ?? null
  const isSignedIn = !!user
  const displayName = user?.name || user?.username || 'You'
  const [stats, setStats] = useState(null)
  const [dbUserId, setDbUserId] = useState(null)
  const [eloData, setEloData] = useState(null)
  const [mlProfiles, setMlProfiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [expandedProfile, setExpandedProfile] = useState(null)

  useEffect(() => {
    if (!user) {
      setStats(null)
      return
    }

    setLoading(true)
    setError(null)

    async function load() {
      try {
        const token = await getToken()

        // Use cached DB user to skip the sync round-trip on repeat visits.
        const cacheKey = `xo_dbuser_${user.id}`
        let dbUserId = null
        try {
          const raw = sessionStorage.getItem(cacheKey)
          if (raw) dbUserId = JSON.parse(raw)?.id ?? null
        } catch {}

        if (!dbUserId) {
          const { user: synced } = await api.users.sync(token)
          dbUserId = synced.id
          try { sessionStorage.setItem(cacheKey, JSON.stringify(synced)) } catch {}
        }

        setDbUserId(dbUserId)
        const [{ stats: s }, eloRes, mlRes] = await Promise.all([
          api.users.stats(dbUserId),
          api.users.eloHistory(dbUserId).catch(() => null),
          api.users.mlProfiles(dbUserId, token).catch(() => null),
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
  }, [user?.id, location.key])

  // Show skeleton while loading data, or while auth is still resolving with no cache
  if (loading || (isPending && !user)) {
    return <StatsSkeleton />
  }

  // Auth resolved and not signed in
  if (!isPending && !isSignedIn) {
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
                <WinRateBar label="vs Humans" rate={stats.pvp.rate} color="var(--color-blue-600)" />
                {['novice', 'intermediate', 'advanced', 'master'].map(d => (
                  <WinRateBar
                    key={d}
                    label={`${AI_NAMES[d]} (${d.charAt(0).toUpperCase() + d.slice(1)})`}
                    rate={stats.pvai[d].rate}
                    color="var(--color-teal-600)"
                  />
                ))}
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
              <ListTable maxHeight="220px">
                <thead>
                  <tr>
                    <ListTh>Bot</ListTh>
                    <ListTh align="right">Games</ListTh>
                    <ListTh align="right">Win Rate</ListTh>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(stats.pvbot.byBot).map((entry, i, arr) => (
                    <ListTr key={entry.bot.id} last={i === arr.length - 1}>
                      <ListTd>
                        <div className="flex items-center gap-2">
                          {entry.bot.avatarUrl && (
                            <img src={entry.bot.avatarUrl} alt="" className="w-5 h-5 rounded-full flex-shrink-0" />
                          )}
                          <span className="font-medium">{entry.bot.displayName ?? 'Bot'}</span>
                        </div>
                      </ListTd>
                      <ListTd align="right">
                        <span className="tabular-nums">{entry.played}</span>
                      </ListTd>
                      <ListTd align="right">
                        <span className="tabular-nums font-semibold" style={{ color: '#9333ea' }}>
                          {Math.round(entry.rate * 100)}%
                        </span>
                      </ListTd>
                    </ListTr>
                  ))}
                </tbody>
              </ListTable>
            </section>
          )}

          {/* ML behavior profiles */}
          {mlProfiles.length > 0 && (
            <section className="space-y-2">
              <SectionLabel>AI Behavior Profiles</SectionLabel>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                How the ML models have learned to read your play style.
              </p>
              <ListTable fitViewport columns={['38%', '10%', '20%', '32%']}>
                <thead>
                  <tr>
                    <ListTh>Model</ListTh>
                    <ListTh align="right">Games</ListTh>
                    <ListTh>Updated</ListTh>
                    <ListTh align="right">Tendencies</ListTh>
                  </tr>
                </thead>
                <tbody>
                  {mlProfiles.map((p, i, arr) => {
                    const tendencies = p.tendencies || {}
                    const isExpanded = expandedProfile === p.id
                    const isLast = i === arr.length - 1
                    return (
                      <React.Fragment key={p.id}>
                        <ListTr
                          onClick={() => setExpandedProfile(prev => prev === p.id ? null : p.id)}
                          last={isExpanded || isLast}
                        >
                          <ListTd>
                            <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{displayName}</div>
                            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>vs {p.model?.name ?? 'Unknown model'}</div>
                          </ListTd>
                          <ListTd align="right">
                            <span className="tabular-nums">{p.gamesRecorded}</span>
                          </ListTd>
                          <ListTd>
                            <span className="text-xs">{new Date(p.updatedAt).toLocaleDateString()}</span>
                          </ListTd>
                          <ListTd align="right">
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                                Center {Math.round((tendencies.centerRate || 0) * 100)}% · Corner {Math.round((tendencies.cornerRate || 0) * 100)}%
                              </span>
                              <svg className="w-3 h-3 flex-shrink-0 transition-transform duration-200" style={{ color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </ListTd>
                        </ListTr>
                        {isExpanded && (
                          <tr style={{ borderBottom: isLast ? 'none' : '1px solid var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
                            <td colSpan={4} className="px-4 py-3">
                              <div className="flex flex-wrap gap-4 items-start">
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
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </ListTable>
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
      <div className="text-lg sm:text-xl font-bold" style={{ fontFamily: 'var(--font-display)', color: color || 'var(--text-primary)' }}>
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
