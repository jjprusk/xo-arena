// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'

export default function TrainingCompletePopup({ onDismiss }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 70,
        backgroundColor: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={onDismiss}
    >

        {/* Card */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Training complete"
          style={{
            background: 'var(--bg-surface)',
            border: '1.5px solid var(--color-teal-400)',
            borderRadius: '1rem',
            padding: '2rem 2rem 1.75rem',
            maxWidth: '22rem',
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 8px 48px rgba(0,0,0,0.55)',
            position: 'relative',
            zIndex: 1,
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ fontSize: 52, lineHeight: 1, marginBottom: '0.75rem' }}>🏆</div>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.1rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            margin: '0 0 0.625rem',
          }}>
            Congrats, your bot is ready for match play!
          </h2>
          <p style={{
            fontSize: '0.875rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.65,
            margin: '0 0 1.5rem',
          }}>
            Your bot has completed training. Time to put it to the test in a tournament!
          </p>
          <button
            onClick={onDismiss}
            className="btn btn-primary"
            style={{ minWidth: '8rem', fontSize: '0.9375rem' }}
          >
            Let's go!
          </button>
        </div>
      </div>
  )
}
