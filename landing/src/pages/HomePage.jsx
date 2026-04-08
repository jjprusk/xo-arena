import React from 'react'
import { Link } from 'react-router-dom'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'

const GAMES = [
  {
    icon: '✕ ○',
    name: 'XO Arena',
    description: 'Tic-tac-toe with ML-driven AI, ELO rankings, live PvP rooms, and tournament play.',
    href: 'https://xo.aiarena.callidity.com',
    badge: 'Play now',
    live: true,
  },
  {
    icon: '⬤',
    name: 'Connect4 Arena',
    description: 'Drop pieces, build strategies, train your own AI model.',
    href: null,
    badge: 'Coming soon',
    live: false,
  },
  {
    icon: '♟',
    name: 'Checkers Arena',
    description: 'Classic checkers with trainable AI and competitive ladder.',
    href: null,
    badge: 'Coming soon',
    live: false,
  },
]

export default function HomePage() {
  const { data: session } = useOptimisticSession()
  const user = session?.user ?? null

  return (
    <div className="flex flex-col">

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="colosseum-bg relative px-6 py-20 text-center">
        <div className="relative z-10 max-w-2xl mx-auto animate-fade-up">
          <h1
            className="text-4xl sm:text-5xl font-bold tracking-tight"
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
            Classic games. Trainable AI. Real-time multiplayer tournaments.
          </p>
          <div className="flex items-center justify-center gap-3 mt-6 flex-wrap">
            <Link to="/tournaments" className="btn btn-primary">
              View Tournaments
            </Link>
            {!user && (
              <a href="https://xo.aiarena.callidity.com" className="btn btn-secondary">
                Play XO Arena
              </a>
            )}
          </div>
        </div>
      </section>

      {/* ── Games grid ─────────────────────────────────────────── */}
      <section className="max-w-4xl mx-auto w-full px-4 py-12">
        <h2
          className="text-sm font-semibold uppercase tracking-widest mb-6"
          style={{ color: 'var(--text-muted)' }}
        >
          Games
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {GAMES.map(game => (
            game.href ? (
              <a
                key={game.name}
                href={game.href}
                className="card p-5 flex flex-col gap-2 no-underline transition-colors hover:bg-[var(--bg-surface-hover)]"
              >
                <GameCardContent game={game} />
              </a>
            ) : (
              <div
                key={game.name}
                className="card p-5 flex flex-col gap-2 opacity-40"
              >
                <GameCardContent game={game} />
              </div>
            )
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
    </div>
  )
}

function GameCardContent({ game }) {
  return (
    <>
      <div className="text-2xl">{game.icon}</div>
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
