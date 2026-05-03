// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { getToken } from '../lib/getToken.js'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import TrainGuidedModal from '../components/guide/TrainGuidedModal.jsx'
import Spotlight from '../components/guide/Spotlight.jsx'

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
  const navigate = useNavigate()
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
  // Guided training (§5.3) — opens TrainGuidedModal which runs a real
  // ~5s Q-Learning self-play session. The modal handles starting the run,
  // streaming live progress over SSE, finalising the bot's primary skill,
  // and crediting journey step 4.
  const [trainOpen, setTrainOpen] = useState(false)
  // Spar (§5.2) — pit this bot against a system bot at the chosen tier.
  // Curriculum step 5 fires when the spar match completes server-side.
  const [sparTier,    setSparTier]    = useState('medium')
  const [sparStarting, setSparStarting] = useState(false)
  const [sparError,   setSparError]   = useState(null)

  // Journey-CTA spotlights — when the user lands here from a journey step
  // (e.g. /profile?action=train-bot → forwarded to /bots/<id>?action=train-bot
  // by ProfilePage), pulse the matching CTA so it stands out from the
  // surrounding controls. The reusable <Spotlight> component owns the scrim
  // + class application; we just track which CTA is lit.
  const [searchParams] = useSearchParams()
  const trainBtnRef = React.useRef(null)
  const sparBtnRef  = React.useRef(null)
  const [trainSpotlightOn, setTrainSpotlightOn] = useState(false)
  const [sparSpotlightOn,  setSparSpotlightOn]  = useState(false)
  useEffect(() => {
    if (loading) return
    const action = searchParams.get('action')
    if (action === 'train-bot') setTrainSpotlightOn(true)
    if (action === 'spar')      setSparSpotlightOn(true)
  }, [searchParams, loading])

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

  function handleTrainGuidedComplete(res) {
    setTrainOpen(false)
    if (res?.bot) setBot(prev => ({ ...prev, ...res.bot }))
  }

  async function handleSpar() {
    setSparError(null)
    setSparStarting(true)
    try {
      const token = await getToken()
      if (!token) throw new Error('Sign in to spar.')
      const { slug } = await api.botGames.practice({ myBotId: id, opponentTier: sparTier }, token)
      // Spar is a bot-vs-bot match — both seats are bots, so we attach as a
      // spectator. Without `watch=1`, /play would default to role=player and
      // the server returns 409 ROOM_FULL because neither seat matches us.
      navigate(`/play?join=${encodeURIComponent(slug)}&watch=1`)
    } catch (err) {
      setSparError(err.message || 'Could not start the spar match. Try again in a moment.')
    } finally {
      setSparStarting(false)
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
    // Mobile: 1rem horizontal padding so section labels ("TRAIN YOUR BOT",
    // "SPAR YOUR BOT") don't run into the viewport edge — uppercase +
    // tracking-widest had them visually cut off on narrow phones. Desktop:
    // padding collapses (px-0) since max-w-lg already centres with margin.
    <div className="max-w-lg mx-auto space-y-6 px-4 sm:px-0">
      {/* Journey CTA spotlights (Curriculum steps 4 + 5). Mounted unconditionally;
          Spotlight no-ops when active=false. */}
      <Spotlight
        active={trainSpotlightOn}
        target={trainBtnRef}
        onDismiss={() => setTrainSpotlightOn(false)}
      />
      <Spotlight
        active={sparSpotlightOn}
        target={sparBtnRef}
        onDismiss={() => setSparSpotlightOn(false)}
      />

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
              Right now your bot plays random valid moves. Watch it actually learn — a few seconds of self-play and it'll start blocking threats and taking wins.
            </p>
            <button
              ref={trainBtnRef}
              onClick={() => { setTrainSpotlightOn(false); setTrainOpen(true) }}
              disabled={trainOpen}
              className="px-4 py-2 rounded-lg text-sm font-semibold border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-50"
              style={{ borderColor: 'var(--color-amber-400)', color: 'var(--color-amber-700)' }}
            >
              Train your bot
            </button>
          </div>
        </section>
      )}

      {/* Guided training modal — owns the entire training experience: live
          win-rate sparkline, ε decay, phase callouts, and the in-modal
          "Bot trained!" celebration. Closes via its own onComplete after
          finalisation; we then update the local bot state so the section
          self-hides (botModelType has flipped from minimax → qlearning). */}
      {trainOpen && (
        <TrainGuidedModal
          botId={bot.id}
          botName={bot.displayName}
          onComplete={handleTrainGuidedComplete}
          onClose={() => setTrainOpen(false)}
        />
      )}

      {/* Spar (Curriculum step 5 — §5.2). Owner-only. Tier picker → kicks off
          a bot-vs-bot match against a system bot; the user spectates and
          step 5 fires server-side on series completion. */}
      {isOwner && bot.botActive && (
        <section className="space-y-2">
          <SectionLabel>Spar your bot</SectionLabel>
          <div
            className="rounded-xl border p-4 space-y-3"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
          >
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Watch your bot play a system bot. Pick a tier — you'll spectate the match live.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {['easy', 'medium', 'hard'].map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => setSparTier(tier)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors"
                  style={{
                    borderColor: sparTier === tier ? 'var(--color-blue-600)' : 'var(--border-default)',
                    backgroundColor: sparTier === tier ? 'var(--color-blue-100)' : 'var(--bg-base)',
                    color: sparTier === tier ? 'var(--color-blue-700)' : 'var(--text-secondary)',
                  }}
                >
                  {tier === 'easy' ? 'Easy · Rusty' : tier === 'medium' ? 'Medium · Copper' : 'Hard · Sterling'}
                </button>
              ))}
            </div>
            {sparError && (
              <p role="alert" className="text-xs" style={{ color: 'var(--color-red-600)' }}>{sparError}</p>
            )}
            <button
              ref={sparBtnRef}
              onClick={() => { setSparSpotlightOn(false); handleSpar() }}
              disabled={sparStarting || bot.botInTournament}
              className="px-4 py-2 rounded-lg text-sm font-semibold border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-50"
              style={{ borderColor: 'var(--color-blue-400)', color: 'var(--color-blue-700)' }}
            >
              {sparStarting ? 'Starting…' : 'Spar now'}
            </button>
            {bot.botInTournament && (
              <p className="text-xs" style={{ color: 'var(--color-amber-600)' }}>
                In a tournament — sparring is disabled until the bot is free.
              </p>
            )}
          </div>
        </section>
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
