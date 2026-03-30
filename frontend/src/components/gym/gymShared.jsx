// Shared constants, helpers, and tiny UI components used across Gym tab files.
import React from 'react'
import { ResponsiveContainer } from 'recharts'

export const MODES = [
  { value: 'SELF_PLAY', label: 'Self-play', desc: 'Plays both X and O' },
  { value: 'VS_MINIMAX', label: 'vs Minimax', desc: 'Plays against the Minimax engine' },
  { value: 'VS_HUMAN', label: 'vs Human', desc: 'Learns from real player games' },
]
export const DIFFICULTIES = ['novice', 'intermediate', 'advanced', 'master']
export const ALGORITHMS = [
  { value: 'Q_LEARNING',      label: 'Q-Learning',     desc: 'Off-policy TD control' },
  { value: 'SARSA',           label: 'SARSA',           desc: 'On-policy TD control' },
  { value: 'MONTE_CARLO',     label: 'Monte Carlo',     desc: 'Every-visit MC control' },
  { value: 'POLICY_GRADIENT', label: 'Policy Gradient', desc: 'REINFORCE (softmax policy)' },
  { value: 'DQN',             label: 'DQN',             desc: 'Deep Q-Network (neural net)' },
  { value: 'ALPHA_ZERO',      label: 'AlphaZero',       desc: 'MCTS + policy/value nets' },
]
export const STATUS_COLOR = { IDLE: 'teal', TRAINING: 'blue' }
export const SESSION_COLOR = { COMPLETED: 'teal', RUNNING: 'blue', FAILED: 'red', CANCELLED: 'amber', PENDING: 'gray', QUEUED: 'yellow' }

// Returns the display name for a player profile, substituting the logged-in
// user's current name when the profile belongs to them.
export function playerLabel(profile, domainUserId, currentUserName) {
  if (domainUserId && profile.userId === domainUserId) {
    return currentUserName || profile.displayName || profile.username || 'You'
  }
  return profile.displayName || profile.username || `${profile.userId.slice(0, 12)}…`
}

export function Card({ children }) {
  return (
    <div className="rounded-xl border p-5 space-y-1"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
      {children}
    </div>
  )
}

export function SectionLabel({ children }) {
  return <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{children}</h3>
}

export function MiniStat({ label, value, color }) {
  return (
    <div className="rounded-lg border p-3" style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)' }}>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-lg font-bold tabular-nums" style={{ fontFamily: 'var(--font-display)', color: color || 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

export function ChartPanel({ label, children }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
      <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <ResponsiveContainer width="100%" height={200}>
        {children}
      </ResponsiveContainer>
    </div>
  )
}

export function StatusBadge({ status, tiny }) {
  const colors = { IDLE: ['var(--color-teal-100)', 'var(--color-teal-700)'], TRAINING: ['var(--color-blue-100)', 'var(--color-blue-700)'], COMPLETED: ['var(--color-teal-100)', 'var(--color-teal-700)'], FAILED: ['var(--color-red-100)', 'var(--color-red-700)'], CANCELLED: ['var(--color-amber-100)', 'var(--color-amber-700)'], PENDING: ['var(--color-gray-100)', 'var(--color-gray-600)'], RUNNING: ['var(--color-blue-100)', 'var(--color-blue-700)'], QUEUED: ['#fef9c3', '#a16207'] }
  const [bg, text] = colors[status] || colors.PENDING
  return (
    <span className={`font-semibold rounded-full ${tiny ? 'text-[9px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'}`}
      style={{ backgroundColor: bg, color: text }}>
      {status}
    </span>
  )
}

export function Btn({ children, onClick, variant = 'primary', disabled, type = 'button' }) {
  const styles = {
    primary: { backgroundColor: 'var(--color-blue-600)', color: 'white' },
    ghost:   { backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-secondary)' },
    danger:  { backgroundColor: 'var(--color-red-50)', color: 'var(--color-red-600)' },
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed"
      style={styles[variant]}>
      {children}
    </button>
  )
}

export function Spinner() {
  return <div className="w-6 h-6 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
}

export const tooltipStyle = { backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }

export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click(); URL.revokeObjectURL(url)
}

export function downloadCSV(rows, keys, filename) {
  const header = keys.join(',')
  const lines  = rows.map(r => keys.map(k => r[k] ?? '').join(','))
  const blob   = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
  const url    = URL.createObjectURL(blob)
  const a      = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click(); URL.revokeObjectURL(url)
}
