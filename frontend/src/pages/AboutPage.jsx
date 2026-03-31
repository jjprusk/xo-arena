import React from 'react'
import { Link } from 'react-router-dom'

export default function AboutPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>About</h1>
      </div>

      {/* What is XO Arena */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>What is XO Arena?</h2>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          XO Arena is a competitive Tic-Tac-Toe platform where you can play against friends,
          challenge AI opponents of varying difficulty, and train your own machine-learning bots.
          Track your ELO rating, climb the leaderboard, and solve hand-crafted puzzles to sharpen
          your game.
        </p>
      </section>

      {/* Features */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Features</h2>
        <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {[
            { icon: '⊞', label: 'Play vs AI or friends in real-time PvP rooms' },
            { icon: '★', label: 'ELO-based leaderboard with weekly and monthly filters' },
            { icon: '◈', label: 'Puzzles — forced-win positions to study and solve' },
            { icon: '⚙', label: 'Gym — train, benchmark, and deploy your own ML bots' },
            { icon: '🤖', label: 'Bot profiles with full match history and training stats' },
          ].map(({ icon, label }) => (
            <li key={label} className="flex items-start gap-3">
              <span className="mt-0.5 text-base leading-none" style={{ color: 'var(--color-blue-600)' }}>{icon}</span>
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Quick links */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Quick links</h2>
        <div className="flex flex-wrap gap-3">
          {[
            { to: '/play', label: 'Play now' },
            { to: '/leaderboard', label: 'Leaderboard' },
            { to: '/ml', label: 'Gym' },
            { to: '/puzzles', label: 'Puzzles' },
          ].map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:brightness-110"
              style={{ backgroundColor: 'var(--color-blue-600)', color: 'white' }}
            >
              {label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
