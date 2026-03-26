import React, { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../lib/api.js'

const ALGORITHM_LABELS = {
  Q_LEARNING: 'Q-Learning',
  SARSA: 'SARSA',
  MONTE_CARLO: 'Monte Carlo',
  POLICY_GRADIENT: 'Policy Gradient',
  DQN: 'DQN',
  ALPHA_ZERO: 'AlphaZero',
  minimax: 'Minimax',
  mcts: 'MCTS',
  rule_based: 'Rule-Based',
}

export default function BotProfilePage() {
  const { id } = useParams()
  const [bot, setBot] = useState(null)
  const [botStats, setBotStats] = useState(null)
  const [eloData, setEloData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setError(null)

    Promise.all([
      api.get(`/users/${id}`),
      api.get(`/users/${id}/bot-stats`).catch(() => null),
      api.get(`/users/${id}/elo-history`).catch(() => null),
    ])
      .then(([userRes, statsRes, eloRes]) => {
        if (!userRes.user?.isBot) {
          setError('Not a bot profile.')
          return
        }
        setBot(userRes.user)
        if (statsRes?.stats) setBotStats(statsRes.stats)
        if (eloRes) setEloData(eloRes)
      })
      .catch(() => setError('Failed to load bot profile.'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="max-w-lg mx-auto flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !bot) {
    return (
      <div className="max-w-lg mx-auto space-y-6 pt-8">
        <p className="text-sm text-center" style={{ color: 'var(--color-red-600)' }}>
          {error || 'Bot not found.'}
        </p>
        <div className="text-center">
          <Link to="/leaderboard" className="text-sm" style={{ color: 'var(--color-blue-600)' }}>
            ← Back to leaderboard
          </Link>
        </div>
      </div>
    )
  }

  const initial = (bot.displayName?.[0] || '?').toUpperCase()
  const poweredBy = bot.mlModel
    ? `${bot.mlModel.name} (${ALGORITHM_LABELS[bot.mlModel.algorithm] ?? bot.mlModel.algorithm})`
    : bot.botModelType
    ? ALGORITHM_LABELS[bot.botModelType] ?? bot.botModelType
    : 'Built-in AI'

  const modelUpdated = bot.mlModel?.updatedAt
    ? new Date(bot.mlModel.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null

  const eloResetDate = bot.botEloResetAt
    ? new Date(bot.botEloResetAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Back link */}
      <Link to="/leaderboard" className="text-sm" style={{ color: 'var(--color-blue-600)' }}>
        ← Back to leaderboard
      </Link>

      {/* Identity card */}
      <div
        className="rounded-xl border p-6 space-y-5"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
      >
        {/* Avatar + name */}
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0 overflow-hidden"
            style={{ backgroundColor: 'var(--color-blue-100)', color: 'var(--color-blue-700)' }}
          >
            {bot.avatarUrl
              ? <img src={bot.avatarUrl} alt={bot.displayName} className="w-full h-full object-cover" />
              : initial}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xl font-bold truncate">{bot.displayName}</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-blue-100)', color: 'var(--color-blue-700)' }}>
                🤖 Bot
              </span>
              {bot.botCalibrating && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-amber-100)', color: 'var(--color-amber-700)' }}>
                  Calibrating
                </span>
              )}
              {!bot.botActive && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-gray-100)', color: 'var(--color-gray-600)' }}>
                  Inactive
                </span>
              )}
              {bot.botCompetitive && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-teal-100)', color: 'var(--color-teal-700)' }}>
                  Competitive
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="h-px" style={{ backgroundColor: 'var(--border-default)' }} />

        {/* Details */}
        <dl className="space-y-3">
          <Row label="ELO" value={
            <span className="tabular-nums font-bold" style={{ color: 'var(--color-blue-600)' }}>
              {Math.round(eloData?.currentElo ?? bot.eloRating ?? 1200)}
              {bot.botCalibrating && <span className="text-xs font-normal ml-1" style={{ color: 'var(--text-muted)' }}>(provisional)</span>}
            </span>
          } />
          <Row label="Powered by" value={poweredBy} />
          {bot.owner && (
            <Row label="Created by" value={bot.owner.displayName} />
          )}
          {!bot.owner && (
            <Row label="Created by" value="XO Arena (built-in)" />
          )}
          {modelUpdated && (
            <Row label="Model last updated" value={modelUpdated} />
          )}
          {bot.mlModel && (
            <Row label="Training episodes" value={bot.mlModel.totalEpisodes.toLocaleString()} />
          )}
          {eloResetDate && (
            <Row label="ELO reset on" value={eloResetDate} />
          )}
          <Row label="Member since" value={new Date(bot.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} />
        </dl>
      </div>

      {/* Win rate breakdown — B-19 */}
      {botStats && botStats.total > 0 && (
        <section className="space-y-2">
          <SectionLabel>Performance</SectionLabel>
          <div
            className="rounded-xl border p-4 space-y-4"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
          >
            <div className="grid grid-cols-3 gap-3 text-center">
              <MiniStat label="Total games" value={botStats.total} />
              <MiniStat label="vs Humans" value={botStats.vsHumans.played} />
              <MiniStat label="vs Bots" value={botStats.vsBots.played} />
            </div>
            {botStats.vsHumans.played > 0 && (
              <WinRateBar label="Win rate vs humans" rate={botStats.vsHumans.rate} color="var(--color-teal-600)" />
            )}
            {botStats.vsBots.played > 0 && (
              <WinRateBar label="Win rate vs bots" rate={botStats.vsBots.rate} color="#9333ea" />
            )}
          </div>
        </section>
      )}

      {/* ELO history */}
      {eloData && eloData.eloHistory.length > 0 && (
        <section className="space-y-2">
          <SectionLabel>Recent ELO changes</SectionLabel>
          <div
            className="rounded-xl border divide-y overflow-hidden"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)', divideColor: 'var(--border-default)' }}
          >
            {eloData.eloHistory.slice(0, 10).map((h) => (
              <div key={h.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-xs capitalize" style={{ color: 'var(--text-muted)' }}>{h.opponentType}</span>
                  <span className="text-xs capitalize" style={{ color: h.outcome === 'win' ? 'var(--color-teal-600)' : h.outcome === 'draw' ? 'var(--color-amber-600)' : 'var(--color-red-600)' }}>
                    {h.outcome}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs tabular-nums">
                  <span style={{ color: h.delta >= 0 ? 'var(--color-teal-600)' : 'var(--color-red-600)' }}>
                    {h.delta >= 0 ? '+' : ''}{Math.round(h.delta)}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>{Math.round(h.eloRating)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-sm" style={{ color: 'var(--text-muted)' }}>{label}</dt>
      <dd className="text-sm font-medium text-right" style={{ color: 'var(--text-primary)' }}>
        {typeof value === 'string' ? value : value}
      </dd>
    </div>
  )
}

function MiniStat({ label, value, color }) {
  return (
    <div>
      <div className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)', color: color || 'var(--text-primary)' }}>{value}</div>
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
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.round(rate * 100)}%`, backgroundColor: color }} />
      </div>
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
