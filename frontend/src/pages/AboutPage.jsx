import React from 'react'
import { Link } from 'react-router-dom'
import changelog from '../../public/changelog.json'
import { ListTable, ListTh, ListTr, ListTd } from '../components/ui/ListTable.jsx'

export default function AboutPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="pb-4 border-b flex items-end gap-3" style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>About</h1>
        <span className="text-sm font-mono pb-1" style={{ color: 'var(--text-secondary)' }}>
          v{import.meta.env.VITE_APP_VERSION}
        </span>
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
            { to: '/gym', label: 'Gym' },
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

      {/* Help */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Help</h2>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/faq" state={{ from: '/about' }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)', backgroundColor: 'var(--bg-surface)' }}
          >
            Frequently Asked Questions →
          </Link>
        </div>
      </section>

      {/* Release history */}
      {changelog.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Release History</h2>
          <ListTable maxHeight="28vh" columns={['16%', '24%', '60%']}>
            <thead>
              <tr>
                <ListTh>Version</ListTh>
                <ListTh>Date</ListTh>
                <ListTh>Notes</ListTh>
              </tr>
            </thead>
            <tbody>
              {changelog.map((entry, i) => (
                <ListTr key={entry.version} last={i === changelog.length - 1}>
                  <ListTd>
                    <span className="font-mono font-semibold" style={{ color: 'var(--color-blue-600)' }}>
                      v{entry.version}
                    </span>
                  </ListTd>
                  <ListTd>
                    <span className="tabular-nums text-xs">
                      {new Date(entry.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </ListTd>
                  <ListTd>{entry.description}</ListTd>
                </ListTr>
              ))}
            </tbody>
          </ListTable>
        </section>
      )}

    </div>
  )
}
