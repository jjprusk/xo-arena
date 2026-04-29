// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * TrainGuidedModal — fullscreen training experience for journey step 4.
 *
 * Replaces the (instant, cosmetic) tier bump in `train-quick` with a real
 * ~5-second Q-Learning self-play run streamed live to the browser:
 *
 *   1. POST /bots/:id/train-guided → { sessionId, skillId, channelPrefix }
 *   2. Subscribe to ml:session:<sessionId>:{progress, complete, error}
 *   3. As ml:progress events arrive, append to a points array and animate
 *      a sparkline of win-rate over episodes. Phase label flips with ε.
 *   4. On ml:complete: show celebration with final stats, POST finalize,
 *      call onComplete (which credits journey step 4 + reopens the guide).
 *
 * The point of this component is *not* the tier bump — it's the visualisation
 * of training itself. A user creating their first bot now SEES learning
 * happen as a curve filling in over a few seconds.
 */
import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'
import { useEventStream } from '../../lib/useEventStream.js'

// Phase labels are progress-driven, not ε-driven. The default Q-Learning
// schedule decays ε from 1.0 to 0.05 within the first ~5% of episodes, so
// ε ranges all collapse to "Polishing" by the time the first progress tick
// reaches the browser. Progress percentage is the honest signal users see.
const PHASE_LABELS = [
  { maxPct: 0.25, label: 'Exploring openings…' },
  { maxPct: 0.50, label: 'Learning threats…' },
  { maxPct: 0.80, label: 'Refining strategy…' },
  { maxPct: 1.01, label: 'Polishing…' },
]

function phaseFor(pct) {
  for (const p of PHASE_LABELS) if (pct < p.maxPct) return p.label
  return PHASE_LABELS[PHASE_LABELS.length - 1].label
}

/** Minimal hand-rolled SVG sparkline — no Recharts dep. */
function WinRateSparkline({ points, totalEpisodes }) {
  const W = 480, H = 140, PAD = 8
  if (points.length === 0) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" style={{ display: 'block' }}>
        <rect x="0" y="0" width={W} height={H} fill="rgba(255,255,255,0.04)" rx="8" />
      </svg>
    )
  }
  const xMax = Math.max(totalEpisodes || points[points.length - 1].episode, 1)
  const path = points.map((p, i) => {
    const x = PAD + ((W - 2 * PAD) * p.episode) / xMax
    const y = PAD + (H - 2 * PAD) * (1 - Math.max(0, Math.min(1, p.winRate)))
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const lastP = points[points.length - 1]
  const lastX = PAD + ((W - 2 * PAD) * lastP.episode) / xMax
  const lastY = PAD + (H - 2 * PAD) * (1 - Math.max(0, Math.min(1, lastP.winRate)))
  // Fill area under the curve so the climb reads at a glance.
  const area = `${path} L${lastX.toFixed(1)},${(H - PAD).toFixed(1)} L${PAD},${(H - PAD).toFixed(1)} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="xo-train-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(245,158,11,0.55)" />
          <stop offset="100%" stopColor="rgba(245,158,11,0)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={W} height={H} fill="rgba(255,255,255,0.04)" rx="8" />
      {/* Reference line at 50% win-rate. */}
      <line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2}
        stroke="rgba(255,255,255,0.18)" strokeDasharray="3 4" strokeWidth="1" />
      <path d={area} fill="url(#xo-train-fill)" />
      <path d={path} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="4" fill="#fff" stroke="#f59e0b" strokeWidth="2" />
    </svg>
  )
}

function StatTile({ label, value, accent }) {
  return (
    <div className="rounded-lg border px-3 py-2 text-center"
      style={{
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderColor:     'rgba(255,255,255,0.10)',
      }}>
      <div className="text-lg font-bold tabular-nums" style={{ color: accent || 'white', fontFamily: 'var(--font-display)' }}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
        {label}
      </div>
    </div>
  )
}

export default function TrainGuidedModal({ botId, botName, onComplete, onClose }) {
  const [sessionId,    setSessionId]    = useState(null)
  const [skillId,      setSkillId]      = useState(null)
  const [channelPrefix, setChannelPrefix] = useState(null)
  const [points,       setPoints]       = useState([])
  const [latest,       setLatest]       = useState(null)
  const [totalEpisodes, setTotalEpisodes] = useState(0)
  const [phase,        setPhase]        = useState('Warming up…')
  const [status,       setStatus]       = useState('starting') // starting | training | finalizing | done | error
  const [errorMsg,     setErrorMsg]     = useState(null)
  const [summary,      setSummary]      = useState(null)
  const startedRef = useRef(false)

  // ── Kick off the training session on mount ──────────────────────────────
  // The startedRef gate dedupes StrictMode's double-mount in dev so we don't
  // POST /train-guided twice. We deliberately do NOT pair it with a closure-
  // scoped `cancelled` flag flipped from a cleanup return — under
  // StrictMode that combo wedges the modal:
  //   1) first mount: startedRef=true, async POST starts
  //   2) cleanup: cancelled=true on the first closure
  //   3) second mount: startedRef is already true → early return; the first
  //      closure's cancelled is still true
  //   4) POST resolves → `if (cancelled) return` skips setState forever
  //      → modal stays at status='starting' "Preparing self-play episodes…"
  // The backend's existingRunning check makes the POST idempotent, so even
  // if it did fire twice the second call returns the same session row.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) throw new Error('Sign in to train your bot.')
        const res = await api.bots.trainGuided(botId, token)
        setSessionId(res.sessionId)
        setSkillId(res.skillId)
        setChannelPrefix(res.channelPrefix)
        setStatus('training')
      } catch (err) {
        setErrorMsg(err.message || 'Could not start training.')
        setStatus('error')
      }
    })()
  }, [botId])

  // ── Subscribe to the live training stream ───────────────────────────────
  // The shared EventSource doesn't pass a server-side filter (see
  // useEventStream); we provide both `channels` (client dispatch prefix) and
  // `eventTypes` (named SSE listeners) since the event names are dynamic
  // per session and won't be in KNOWN_SSE_EVENT_TYPES.
  const eventTypes = channelPrefix
    ? [
        `${channelPrefix}progress`,
        `${channelPrefix}complete`,
        `${channelPrefix}error`,
        `${channelPrefix}cancelled`,
        `${channelPrefix}early_stop`,
      ]
    : []

  useEventStream({
    enabled:    Boolean(channelPrefix),
    channels:   channelPrefix ? [channelPrefix] : [],
    eventTypes,
    onEvent: (channel, payload) => {
      if (channel.endsWith(':progress')) {
        if (typeof payload.totalEpisodes === 'number') setTotalEpisodes(payload.totalEpisodes)
        const next = {
          episode:   Number(payload.episode || 0),
          winRate:   Number(payload.winRate ?? 0),
          lossRate:  Number(payload.lossRate ?? 0),
          drawRate:  Number(payload.drawRate ?? 0),
          epsilon:   Number(payload.epsilon ?? 0),
        }
        setPoints(prev => prev.length > 0 && prev[prev.length - 1].episode >= next.episode ? prev : [...prev, next])
        setLatest(next)
        const total = Number(payload.totalEpisodes) || totalEpisodes || next.episode
        setPhase(phaseFor(total > 0 ? next.episode / total : 0))
      } else if (channel.endsWith(':complete')) {
        setSummary(payload.summary || null)
        setStatus('finalizing')
      } else if (channel.endsWith(':error')) {
        setErrorMsg(payload.error || 'Training failed.')
        setStatus('error')
      } else if (channel.endsWith(':cancelled')) {
        setErrorMsg('Training was cancelled.')
        setStatus('error')
      }
    },
  })

  // ── Finalize once the training run completes ────────────────────────────
  // Same StrictMode trap as the startup effect — a closure-scoped cancelled
  // flag flipped from a cleanup return wedges the second mount because the
  // first run's closure variable stays at `true`. Use a ref instead so the
  // celebration timer can still no-op on a real unmount without leaking.
  const finalizeStartedRef = useRef(false)
  const unmountedRef       = useRef(false)
  useEffect(() => () => { unmountedRef.current = true }, [])

  useEffect(() => {
    if (status !== 'finalizing') return
    if (finalizeStartedRef.current) return
    finalizeStartedRef.current = true
    ;(async () => {
      try {
        const token = await getToken()
        const res = await api.bots.trainGuidedFinalize(botId, { sessionId, skillId }, token)
        if (unmountedRef.current) return
        setStatus('done')
        // Brief celebration window before we call onComplete (~2.5s).
        setTimeout(() => { if (!unmountedRef.current) onComplete?.(res) }, 2500)
      } catch (err) {
        if (unmountedRef.current) return
        setErrorMsg(err.message || 'Could not save the trained bot.')
        setStatus('error')
      }
    })()
  }, [status, botId, sessionId, skillId, onComplete])

  const progressPct = totalEpisodes > 0 && latest
    ? Math.min(100, Math.round((latest.episode / totalEpisodes) * 100))
    : 0
  const winPct  = latest ? Math.round(latest.winRate  * 100) : 0
  const drawPct = latest ? Math.round(latest.drawRate * 100) : 0
  const lossPct = latest ? Math.round(latest.lossRate * 100) : 0

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Training your bot"
      style={{
        position: 'fixed', inset: 0, zIndex: 1300,
        background: 'rgba(8,12,22,0.78)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        className="rounded-2xl border w-full max-w-xl"
        style={{
          backgroundColor: '#0f1626',
          borderColor:     'rgba(245,158,11,0.45)',
          boxShadow:       '0 24px 80px rgba(0,0,0,0.55), 0 0 0 4px rgba(245,158,11,0.10)',
          color:           'white',
        }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-3">
          <div className="flex items-center gap-3">
            <div style={{ fontSize: '2rem', lineHeight: 1 }}>🧠</div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold">
                {status === 'done' ? 'Bot trained!' : `Training ${botName || 'your bot'}…`}
              </h3>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.65)' }}>
                {status === 'starting' && 'Preparing self-play episodes…'}
                {status === 'training' && phase}
                {status === 'finalizing' && 'Saving the trained model…'}
                {status === 'done' && 'Your bot just learned to block threats and take wins.'}
                {status === 'error' && (errorMsg || 'Something went wrong.')}
              </p>
            </div>
            <div className="text-right tabular-nums">
              <div className="text-2xl font-bold" style={{ color: '#f59e0b', fontFamily: 'var(--font-display)' }}>
                {progressPct}%
              </div>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.55)' }}>
                {latest ? `ep ${latest.episode}` : '—'}/{totalEpisodes || '—'}
              </div>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="px-6">
          <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.10)' }}>
            <div className="h-full transition-all duration-300"
              style={{ width: `${progressPct}%`, backgroundImage: 'linear-gradient(90deg,#f59e0b,#ea580c)' }} />
          </div>
        </div>

        {/* Chart */}
        <div className="px-6 mt-4">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Win rate
            </span>
            <span className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.85)' }}>
              {points.length} samples
            </span>
          </div>
          <WinRateSparkline points={points} totalEpisodes={totalEpisodes} />
        </div>

        {/* Stats */}
        <div className="px-6 mt-4 grid grid-cols-4 gap-2">
          <StatTile label="Win"  value={`${winPct}%`}  accent="#34d399" />
          <StatTile label="Draw" value={`${drawPct}%`} accent="#fbbf24" />
          <StatTile label="Loss" value={`${lossPct}%`} accent="#f87171" />
          <StatTile label="ε"    value={latest ? latest.epsilon.toFixed(3) : '—'} />
        </div>

        {/* Footer */}
        <div className="px-6 py-5 mt-4 flex items-center justify-end gap-3"
          style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          {status === 'error' && (
            <>
              <p role="alert" className="text-xs flex-1" style={{ color: '#fca5a5' }}>{errorMsg}</p>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-semibold border"
                style={{ borderColor: 'rgba(255,255,255,0.25)', color: 'white' }}
              >
                Close
              </button>
            </>
          )}
          {status === 'done' && (
            <button
              onClick={() => onComplete?.()}
              className="px-5 py-2 rounded-lg text-sm font-semibold"
              style={{ backgroundImage: 'linear-gradient(135deg,#f59e0b,#ea580c)', color: 'white' }}
            >
              Continue
            </button>
          )}
          {(status === 'starting' || status === 'training' || status === 'finalizing') && (
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
              {status === 'finalizing' ? 'Almost there…' : 'A few seconds…'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
