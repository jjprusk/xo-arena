// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { getToken } from '../lib/getToken.js'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'

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
  const { data: session } = useOptimisticSession()
  const [bot, setBot] = useState(null)
  const [botStats, setBotStats] = useState(null)
  const [eloData, setEloData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [availToggling, setAvailToggling] = useState(false)
  const [availError, setAvailError] = useState(null)
  const [sessions, setSessions] = useState([])
  const [selectedSession, setSelectedSession] = useState('')
  // Quick Bot training (§5.3) — bumps a fresh Quick Bot from novice to
  // intermediate tier. Hides itself once the bot is trained.
  const [trainingQuick,    setTrainingQuick]    = useState(false)
  const [trainQuickError,  setTrainQuickError]  = useState(null)
  const [trainQuickResult, setTrainQuickResult] = useState(null)

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
        const botUser = userRes.user
        setBot(botUser)
        if (statsRes?.stats) setBotStats(statsRes.stats)
        if (eloRes) setEloData(eloRes)
        // Load training sessions if this bot has an ML model
        if (botUser.mlModel?.id) {
          api.ml.getSessions(botUser.mlModel.id).then(r => {
            setSessions(r.sessions || [])
            if (r.sessions?.length > 0) setSelectedSession(r.sessions[0].id)
          }).catch(() => {})
        }
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
          <Link to="/profile" className="text-sm" style={{ color: 'var(--color-blue-600)' }}>
            ← Back to profile
          </Link>
        </div>
      </div>
    )
  }

  const isOwner = session?.user?.id && bot.ownerBetterAuthId && session.user.id === bot.ownerBetterAuthId

  async function handleTrainQuick() {
    setTrainQuickError(null)
    setTrainingQuick(true)
    try {
      const token = await getToken()
      if (!token) throw new Error('Sign in to train your bot.')
      const { bot: updated, alreadyTrained } = await api.bots.trainQuick(id, token)
      setBot(prev => ({ ...prev, ...updated }))
      setTrainQuickResult(alreadyTrained ? 'already' : 'trained')
    } catch (err) {
      setTrainQuickError(err.message || 'Could not train your bot. Try again in a moment.')
    } finally {
      setTrainingQuick(false)
    }
  }

  async function toggleAvailability() {
    const next = !bot.botAvailable
    setBot(prev => ({ ...prev, botAvailable: next }))  // optimistic
    setAvailError(null)
    setAvailToggling(true)
    try {
      const token = await getToken()
      const { bot: updated } = await api.bots.update(id, { botAvailable: next }, token)
      setBot(prev => ({ ...prev, botAvailable: updated.botAvailable }))
    } catch (err) {
      setBot(prev => ({ ...prev, botAvailable: !next }))  // roll back
      setAvailError(err.message || 'Failed to update availability.')
    } finally {
      setAvailToggling(false)
    }
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
      <Link to="/profile" className="text-sm" style={{ color: 'var(--color-blue-600)' }}>
        ← Back to profile
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
              {bot.botProvisional && (
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
              {bot.botProvisional && <span className="text-xs font-normal ml-1" style={{ color: 'var(--text-muted)' }}>(provisional)</span>}
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

      {/* Quick Bot training (Curriculum step 4 — §5.3). Only shown for the
          owner of a minimax bot still on the default (novice) tier; the
          training-flow trigger bumps it to the intermediate tier. */}
      {isOwner && bot.botModelType === 'minimax' && typeof bot.botModelId === 'string' && bot.botModelId.endsWith(':novice') && (
        <section className="space-y-2">
          <SectionLabel>Train your bot</SectionLabel>
          <div
            className="rounded-xl border p-4 space-y-3"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
          >
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Right now your bot plays random valid moves. The first training run sharpens it to block threats and take wins.
            </p>
            {trainQuickError && (
              <p role="alert" className="text-xs" style={{ color: 'var(--color-red-600)' }}>{trainQuickError}</p>
            )}
            <button
              onClick={handleTrainQuick}
              disabled={trainingQuick}
              className="px-4 py-2 rounded-lg text-sm font-semibold border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-50"
              style={{ borderColor: 'var(--color-amber-400)', color: 'var(--color-amber-700)' }}
            >
              {trainingQuick ? 'Training…' : 'Train your bot'}
            </button>
          </div>
        </section>
      )}

      {/* Post-training celebration — shown briefly after a successful bump. */}
      {trainQuickResult === 'trained' && (
        <div
          className="rounded-xl border p-4 text-sm"
          role="status"
          style={{ backgroundColor: 'rgba(36,181,135,0.07)', borderColor: 'var(--color-teal-400)', color: 'var(--color-teal-700)' }}
        >
          <strong>Trained!</strong> Your bot is now at the intermediate tier — blocking threats and taking wins.
        </div>
      )}

      {/* Win rate breakdown */}
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

      {/* Owner availability toggle */}
      {isOwner && (
        <section className="space-y-2">
          <SectionLabel>Tournament availability</SectionLabel>
          <div
            className="rounded-xl border p-4 flex items-center justify-between gap-4"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
          >
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {bot.botAvailable ? 'Available for tournaments' : 'Not available for tournaments'}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {bot.botAvailable
                  ? 'Your bot may be slotted into bracket tournaments.'
                  : 'Your bot will be skipped when building tournament brackets.'}
              </p>
              {bot.botInTournament && (
                <p className="text-xs mt-1 font-medium" style={{ color: 'var(--color-amber-600)' }}>
                  Currently in a tournament — availability cannot be changed.
                </p>
              )}
              {availError && <p className="text-xs mt-1" style={{ color: 'var(--color-red-600)' }}>{availError}</p>}
            </div>
            <button
              onClick={toggleAvailability}
              disabled={availToggling || bot.botInTournament}
              className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
              style={{
                borderColor: bot.botAvailable ? 'var(--color-orange-300)' : 'var(--color-teal-300)',
                color: bot.botAvailable ? 'var(--color-orange-600)' : 'var(--color-teal-600)',
              }}
            >
              {availToggling ? '…' : bot.botAvailable ? 'Opt out' : 'Opt in'}
            </button>
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

      {/* Training sessions */}
      {sessions.length > 0 && (
        <section className="space-y-2">
          <SectionLabel>Training sessions</SectionLabel>
          <div className="rounded-xl border p-4 space-y-3"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
            <select value={selectedSession} onChange={e => setSelectedSession(e.target.value)}
              className="w-full text-sm rounded-lg border px-3 py-2 outline-none"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  {new Date(s.startedAt).toLocaleDateString()} · {s.mode.replace(/_/g, ' ')} · {s.iterations.toLocaleString()} eps · {s.status}
                </option>
              ))}
            </select>
            {(() => {
              const sel = sessions.find(s => s.id === selectedSession)
              if (!sel) return null
              const dur = sel.startedAt && sel.completedAt
                ? (() => { const ms = new Date(sel.completedAt) - new Date(sel.startedAt); const m = Math.floor(ms / 60000); const s2 = Math.floor((ms % 60000) / 1000); return m > 0 ? `${m}m ${s2}s` : `${s2}s` })()
                : '—'
              return (
                <div className="rounded-lg border px-4 py-3 space-y-2"
                  style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span style={{ color: 'var(--text-muted)' }}>Mode: </span><span className="font-medium">{sel.mode.replace(/_/g, ' ')}</span></div>
                    <div><span style={{ color: 'var(--text-muted)' }}>Status: </span><span className="font-medium">{sel.status}</span></div>
                    <div><span style={{ color: 'var(--text-muted)' }}>Episodes: </span><span className="font-medium">{sel.iterations.toLocaleString()}</span></div>
                    <div><span style={{ color: 'var(--text-muted)' }}>Duration: </span><span className="font-medium">{dur}</span></div>
                    {sel.summary?.winRate != null && <div><span style={{ color: 'var(--text-muted)' }}>Win rate: </span><span className="font-medium">{(sel.summary.winRate * 100).toFixed(1)}%</span></div>}
                    {sel.summary?.finalEpsilon != null && <div><span style={{ color: 'var(--text-muted)' }}>Final ε: </span><span className="font-medium">{sel.summary.finalEpsilon.toFixed(4)}</span></div>}
                  </div>
                </div>
              )
            })()}
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
