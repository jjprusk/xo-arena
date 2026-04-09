import React from 'react'
import Modal from '../ui/Modal.jsx'

/**
 * Shown once to first-time visitors who are not signed in.
 * Explains what guests can do vs what requires an account.
 * Dismissed state is persisted in localStorage.
 */
export default function GuestWelcomeModal({ isOpen, onClose, onRegister }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="sm">
      <div style={{ padding: '1.75rem 1.5rem 1.5rem' }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Welcome to XO Arena
        </h2>
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          You can jump straight in without an account:
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <Feature icon="⊞" text="Play games against bots and the community" />
          <Feature icon="★" text="Browse the leaderboard and rankings" />
          <Feature icon="◈" text="Solve puzzles" />
          <Feature icon="🏆" text="Watch tournaments" />
        </div>

        <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Create a free account to unlock:
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
          <Feature icon="⚡" text="Build and train your own AI bots" locked />
          <Feature icon="🏆" text="Enter and compete in tournaments" locked />
          <Feature icon="◎" text="Track your stats and match history" locked />
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={onRegister}
            className="btn-primary"
            style={{ flex: 1, padding: '0.6rem 1rem', fontWeight: 600, fontSize: '0.9rem' }}
          >
            Create free account
          </button>
          <button
            onClick={onClose}
            className="btn-ghost"
            style={{ padding: '0.6rem 1rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}
          >
            Play as guest
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Feature({ icon, text, locked = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
      <span style={{ fontSize: '1rem', width: '1.25rem', textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{
        fontSize: '0.875rem',
        color: locked ? 'var(--text-secondary)' : 'var(--text-primary)',
      }}>
        {text}
      </span>
    </div>
  )
}
