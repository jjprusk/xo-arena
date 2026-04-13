// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'

/**
 * Shown once to first-time visitors who are not signed in.
 * Uses localStorage key 'aiarena_guest_welcome_seen' to persist dismissal.
 */
export default function GuestWelcomeModal({ isOpen, onClose, onSignIn }) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to AI Arena"
        className="w-full rounded-2xl"
        style={{ maxWidth: '26rem', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-card)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '1.75rem 1.5rem 1.5rem' }}>
          <h2 style={{ margin: '0 0 0.375rem', fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            Welcome to AI Arena
          </h2>
          <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            The competitive platform for classic games with trainable AI.
          </p>

          <p style={{ margin: '0 0 0.625rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Free to browse
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1.25rem' }}>
            <Feature icon="🏆" text="Browse and watch tournaments" />
            <Feature icon="★"  text="View rankings and leaderboards" />
            <Feature icon="⊞"  text="Play games as a guest on XO Arena" />
          </div>

          <p style={{ margin: '0 0 0.625rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            With a free account
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1.5rem' }}>
            <Feature icon="⊕"  text="Enter and compete in tournaments" locked />
            <Feature icon="⚡" text="Build and train your own AI bots" locked />
            <Feature icon="◎"  text="Track your stats and match history" locked />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={onSignIn}
              className="btn btn-primary"
              style={{ flex: 1, fontWeight: 600 }}
            >
              Sign in
            </button>
            <button
              onClick={onClose}
              className="btn btn-ghost"
              style={{ padding: '0.6rem 1rem', color: 'var(--text-secondary)' }}
            >
              Browse first
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Feature({ icon, text, locked = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
      <span style={{ fontSize: '1rem', width: '1.25rem', textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: '0.875rem', color: locked ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
        {text}
      </span>
    </div>
  )
}
