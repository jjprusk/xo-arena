// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { prefetchCommunityBot } from '../lib/communityBotCache.js'
import DemoArena from '../components/home/DemoArena.jsx'
import SignInModal from '../components/ui/SignInModal.jsx'
import { readGuestJourney } from '../lib/guestMode.js'

/**
 * HomePage — Phase 0 redesign (Intelligent Guide v1, §3.5.1).
 *
 * Hero is a live bot-vs-bot demo arena instead of generic marketing text.
 * Three-CTA progressive ladder beneath:
 *
 *   1. Watch another match — refreshes the demo (zero friction)
 *   2. Play against a bot  — opens /play?action=vs-community-bot (guest PvAI)
 *   3. Build your own bot  — opens signup with contextual copy (signup ask)
 *
 * The "Build your own bot" CTA is the conversion moment — it surfaces the
 * platform's unique value (user-built bots that compete) and gates it behind
 * signup. Visitor sees the unique thing first (bots playing), then is asked
 * to commit at the moment they want to participate.
 *
 * For signed-in users, the page replaces the sign-up CTA with a "Continue
 * your journey" link to /play.
 */

function InfoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <line x1="8" y1="7.5" x2="8" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="5.25" r="0.85" fill="currentColor" />
    </svg>
  )
}

function XOIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="XO">
      <rect width="32" height="32" rx="7" fill="var(--color-blue-600)" />
      <line x1="11" y1="5"  x2="11" y2="27" stroke="white"                 strokeWidth="2.5" strokeLinecap="round" />
      <line x1="21" y1="5"  x2="21" y2="27" stroke="var(--color-teal-400)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="5"  y1="11" x2="27" y2="11" stroke="white"                 strokeWidth="2.5" strokeLinecap="round" />
      <line x1="5"  y1="21" x2="27" y2="21" stroke="var(--color-teal-400)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

const GAMES = [
  {
    icon: <XOIcon />,
    name: 'XO Arena',
    description: 'Tic-tac-toe with AI-driven bots, ELO rankings, player vs. player (PvP) rooms, and tournament play.',
    href: '/play?action=vs-community-bot',
    badge: 'Play now',
    live: true,
    aiInfo: {
      fullName: 'Tic-Tac-Toe',
      stateSpace: '5,477 legal positions',
      gameTree: '~255,168 terminal nodes',
      branchingFactor: '~4.6 avg moves per turn',
      avgGameLength: '~7 moves',
      board: '3×3 grid, 9 cells',
      solved: 'Yes — optimal play always draws',
      modelRanking: [
        { name: 'Minimax',         note: 'Perfect play — fully solves XO' },
        { name: 'AlphaZero',       note: 'Neural network + MCTS' },
        { name: 'DQN',             note: 'Deep Q-network' },
        { name: 'MCTS',            note: 'Monte Carlo tree search' },
        { name: 'Monte Carlo',     note: 'Tabular rollout policy' },
        { name: 'Q-Learning',      note: 'Tabular temporal-difference' },
        { name: 'SARSA',           note: 'On-policy TD learning' },
        { name: 'Policy Gradient', note: 'Direct policy optimisation' },
        { name: 'Rule-based',      note: 'Hand-coded heuristics' },
        { name: 'Random',          note: 'Unguided baseline' },
      ],
    },
  },
  {
    icon: '⬤',
    name: 'Connect4 Arena',
    description: 'Drop pieces, build strategies, train your own AI model.',
    href: null,
    badge: 'Coming soon',
    live: false,
    aiInfo: {
      fullName: 'Connect Four',
      stateSpace: '~4.5 trillion positions',
      gameTree: '~4.5 × 10²¹ nodes',
      branchingFactor: '~7 (one per column)',
      avgGameLength: '~36 moves',
      board: '7×6 grid, 42 cells',
      solved: 'Yes — first player wins with perfect play',
      modelRanking: null,
    },
  },
  {
    icon: '♟',
    name: 'Checkers Arena',
    description: 'Classic checkers with trainable AI and competitive ladder.',
    href: null,
    badge: 'Coming soon',
    live: false,
    aiInfo: {
      fullName: 'Checkers (Draughts)',
      stateSpace: '~5 × 10²⁰ positions',
      gameTree: '~10³¹ nodes',
      branchingFactor: '~9 avg moves per turn',
      avgGameLength: '~60 moves',
      board: '8×8 board, 32 active dark squares',
      solved: 'Yes — optimal play draws',
      modelRanking: null,
    },
  },
]

export default function HomePage() {
  const { data: session } = useOptimisticSession()
  const user = session?.user ?? null
  const [openInfoGame, setOpenInfoGame] = useState(null)
  const [signupOpen, setSignupOpen]     = useState(false)
  const [demoKey, setDemoKey]           = useState(0)

  // Has the visitor already completed the first PvAI game? Drives the
  // CTA-emphasis swap: pre-play guests see Play as the primary blue button
  // (the right next step); after playing, Build → signup becomes primary.
  // Read once on mount — when the user returns to `/` after /play, this
  // page remounts and the fresh localStorage state is picked up.
  const [playedFirstGame] = useState(() => !!readGuestJourney().hookStep1CompletedAt)
  const buildIsPrimary = !!user || playedFirstGame
  const playClass  = buildIsPrimary ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'
  const buildClass = buildIsPrimary ? 'btn btn-primary btn-sm'   : 'btn btn-secondary btn-sm'

  // Prefetch the community bot list so /play?action=vs-community-bot is instant.
  useEffect(() => { prefetchCommunityBot() }, [])

  return (
    <div className="flex flex-col">

      {/* ── Hero — live demo + progressive CTA ladder ─────────── */}
      <section className="relative px-4 sm:px-6 pt-12 pb-8 text-center">
        <div className="relative z-10 max-w-2xl mx-auto animate-fade-up">
          <h1
            className="text-3xl sm:text-5xl font-bold tracking-tight"
            style={{
              fontFamily: 'var(--font-display)',
              background: 'linear-gradient(135deg, var(--color-slate-500), var(--color-slate-300))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            AI Arena
          </h1>
          <p className="mt-3 text-base sm:text-lg" style={{ color: 'var(--text-secondary)' }}>
            Build a bot. Train it. Watch it compete.
          </p>
        </div>

        {/* Live bot-vs-bot demo */}
        <div className="mt-8 mb-6">
          <DemoArena key={demoKey} />
        </div>

        {/* Progressive CTA ladder.
            Layout — the two top-row "action" buttons (Watch / Play) sit in a
            2-column grid so they line up cleanly even on a narrow phone
            viewport (the prior `flex-wrap` reflowed them at uneven heights and
            mismatched styles, looking haphazard). The conversion CTA "Build
            your own bot" gets its own full-width row below — it's the
            funnel-defining moment and benefits from the visual emphasis. */}
        <div className="max-w-lg mx-auto space-y-2 sm:space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <button
              onClick={() => setDemoKey(k => k + 1)}
              className="btn btn-secondary btn-sm w-full"
              type="button"
              aria-label="Watch another bot match"
            >
              ↻ Watch another match
            </button>
            <Link
              to="/play?action=vs-community-bot"
              className={`${playClass} w-full`}
            >
              Play against a bot
            </Link>
          </div>
          {user ? (
            <Link to="/gym" className={`${buildClass} w-full`}>
              Build your own bot →
            </Link>
          ) : (
            <button
              onClick={() => setSignupOpen(true)}
              className={`${buildClass} w-full`}
              type="button"
              data-cta="build-your-own-bot"
            >
              Build your own bot →
            </button>
          )}
        </div>

        {/* Sub-line beneath the CTAs reinforcing the unique value prop */}
        <p className="mt-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Free account, no credit card. Your bot competes in tournaments against bots built by other players.
        </p>
      </section>

      {/* ── Games grid ─────────────────────────────────────────── */}
      <section className="max-w-4xl mx-auto w-full px-4 py-8">
        <h2
          className="text-sm font-semibold uppercase tracking-widest mb-6"
          style={{ color: 'var(--text-muted)' }}
        >
          Games
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {GAMES.map(game => (
            <div key={game.name} className="relative">
              {game.href ? (
                <Link
                  to={game.href}
                  className="card p-5 flex flex-col gap-2 no-underline transition-colors hover:bg-[var(--bg-surface-hover)]"
                >
                  <GameCardContent game={game} />
                </Link>
              ) : (
                <div className="card p-5 flex flex-col gap-2 opacity-40">
                  <GameCardContent game={game} />
                </div>
              )}
              <button
                className="absolute top-3 right-3 z-10 p-1 rounded-md transition-colors hover:bg-[var(--bg-surface-hover)]"
                style={{ color: 'var(--text-muted)' }}
                onClick={e => { e.preventDefault(); e.stopPropagation(); setOpenInfoGame(game) }}
                aria-label={`${game.name} AI info`}
              >
                <InfoIcon />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── Tournament highlight ────────────────────────────────── */}
      <section className="max-w-4xl mx-auto w-full px-4 pb-16">
        <div
          className="rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4"
          style={{ backgroundColor: 'var(--color-slate-50)', border: '1px solid var(--color-slate-200)' }}
        >
          <div className="flex-1">
            <p
              className="text-sm font-bold"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-slate-700)' }}
            >
              Cross-game Tournaments
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-slate-600)' }}>
              Compete in structured brackets, earn merits, climb the classification ladder from Recruit to Legend.
            </p>
          </div>
          <Link to="/tournaments" className="btn btn-primary btn-sm whitespace-nowrap">
            Browse Tournaments →
          </Link>
        </div>
      </section>

      {openInfoGame && (
        <GameInfoPanel game={openInfoGame} onClose={() => setOpenInfoGame(null)} />
      )}

      {signupOpen && (
        <SignInModal
          onClose={() => setSignupOpen(false)}
          defaultView="sign-up"
          context="build-bot"
        />
      )}
    </div>
  )
}

function GameCardContent({ game }) {
  return (
    <>
      <div className="text-2xl leading-none">{game.icon}</div>
      <p className="text-sm font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
        {game.name}
      </p>
      <p className="text-xs flex-1" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {game.description}
      </p>
      <span
        className="badge"
        style={game.live
          ? { backgroundColor: 'var(--color-slate-100)', color: 'var(--color-slate-700)' }
          : { backgroundColor: 'var(--color-gray-100)', color: 'var(--text-muted)' }
        }
      >
        {game.badge}
      </span>
    </>
  )
}

function GameInfoPanel({ game, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { aiInfo } = game

  const stats = [
    { label: 'State space',      value: aiInfo.stateSpace },
    { label: 'Game tree',        value: aiInfo.gameTree },
    { label: 'Branching factor', value: aiInfo.branchingFactor },
    { label: 'Avg game length',  value: aiInfo.avgGameLength },
    { label: 'Board',            value: aiInfo.board },
    { label: 'Solved',           value: aiInfo.solved },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${game.name} AI info`}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4 relative"
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg transition-colors hover:bg-[var(--bg-surface-hover)]"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <line x1="2" y1="2" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="12" y1="2" x2="2" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 pr-6">
          <div className="text-2xl leading-none flex-shrink-0">{game.icon}</div>
          <div>
            <p
              className="text-sm font-bold"
              style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
            >
              {game.name}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{aiInfo.fullName}</p>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border-default)' }} />

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {stats.map(({ label, value }) => (
            <div key={label}>
              <p
                className="text-[10px] uppercase tracking-wide mb-0.5"
                style={{ color: 'var(--text-muted)' }}
              >
                {label}
              </p>
              <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{value}</p>
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid var(--border-default)' }} />

        {/* Model rankings */}
        <div>
          <p
            className="text-[10px] font-semibold uppercase tracking-wide mb-2"
            style={{ color: 'var(--text-muted)' }}
          >
            AI Models — best to worst
          </p>
          {aiInfo.modelRanking ? (
            <ol className="flex flex-col gap-1.5">
              {aiInfo.modelRanking.map((m, i) => (
                <li key={m.name} className="flex items-baseline gap-2">
                  <span
                    className="text-[10px] w-4 text-right flex-shrink-0 tabular-nums"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {m.name}
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {m.note}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Model rankings will be available at launch.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
