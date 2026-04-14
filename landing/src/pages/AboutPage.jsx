// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { Link } from 'react-router-dom'
import changelog from '../../public/changelog.json'
import { ListTable, ListTh, ListTr, ListTd } from '../components/ui/ListTable.jsx'

export default function AboutPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      <div className="pb-4 border-b flex items-end gap-3" style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>About</h1>
        <span className="text-sm font-mono pb-1" style={{ color: 'var(--text-secondary)' }}>
          v{import.meta.env.VITE_APP_VERSION}
        </span>
      </div>

      {/* What is AI Arena */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>What is AI Arena?</h2>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          AI Arena is the competitive platform for classic games with trainable AI. Browse and enter
          tournaments, train your own machine-learning bots, track your stats, and climb the
          classification ladder from Recruit to Legend across all supported games.
        </p>
      </section>

      {/* Features */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Features</h2>
        <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {[
            { icon: '🏆', label: 'Structured tournament brackets with ELO and merit scoring' },
            { icon: '★',  label: 'Rankings and leaderboards across all games' },
            { icon: '⚡', label: 'Build, train, and deploy your own ML bots' },
            { icon: '◎',  label: 'Full match history and per-bot training stats' },
            { icon: '⊞',  label: 'Play games live — XO Arena and more coming soon' },
          ].map(({ icon, label }) => (
            <li key={label} className="flex items-start gap-3">
              <span className="mt-0.5 text-base leading-none" style={{ color: 'var(--color-slate-500)' }}>{icon}</span>
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
            { to: '/tournaments', label: 'Tournaments' },
            { to: '/profile',     label: 'My Profile'  },
            { to: '/settings',    label: 'Settings'    },
          ].map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:brightness-110"
              style={{ backgroundColor: 'var(--color-slate-500)', color: 'white' }}
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
                    <span className="font-mono font-semibold" style={{ color: 'var(--color-slate-500)' }}>
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
