// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'

const BURSTS = [
  { left:  '5%', top: '10%', emoji: '🎆', size: 52, dur: 1.4, delay: 0    },
  { left: '22%', top:  '4%', emoji: '🎇', size: 44, dur: 1.6, delay: 0.2  },
  { left: '50%', top:  '2%', emoji: '🎆', size: 60, dur: 1.3, delay: 0.05 },
  { left: '75%', top:  '5%', emoji: '🎇', size: 48, dur: 1.5, delay: 0.15 },
  { left: '93%', top: '12%', emoji: '🎆', size: 50, dur: 1.4, delay: 0.1  },
  { left:  '8%', top: '50%', emoji: '✨', size: 40, dur: 1.7, delay: 0.3  },
  { left: '90%', top: '48%', emoji: '✨', size: 40, dur: 1.7, delay: 0.25 },
  { left: '35%', top:  '6%', emoji: '🎉', size: 44, dur: 1.5, delay: 0.35 },
  { left: '65%', top:  '8%', emoji: '🎉', size: 42, dur: 1.6, delay: 0.4  },
  { left: '15%', top: '25%', emoji: '🎆', size: 36, dur: 1.8, delay: 0.45 },
  { left: '82%', top: '28%', emoji: '🎆', size: 38, dur: 1.7, delay: 0.2  },
]

export default function JourneyCompletePopup({ onDismiss }) {
  return (
    <>
      <style>{`
        @keyframes jc-burst {
          0%   { transform: scale(0) rotate(-15deg); opacity: 0; }
          25%  { opacity: 1; }
          65%  { transform: scale(1.4) rotate(10deg); opacity: 1; }
          100% { transform: scale(0.9) rotate(-5deg); opacity: 0; }
        }
        @keyframes jc-fade-in {
          from { opacity: 0; transform: scale(0.9) translateY(12px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 70,
          backgroundColor: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '1rem',
          overflow: 'hidden',
        }}
        onClick={onDismiss}
      >
        {/* Fireworks */}
        {BURSTS.map((b, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: b.left,
            top: b.top,
            fontSize: b.size,
            lineHeight: 1,
            pointerEvents: 'none',
            animation: `jc-burst ${b.dur}s ease-out ${b.delay}s both`,
          }}>{b.emoji}</div>
        ))}

        {/* Card */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Journey complete"
          style={{
            background: 'var(--bg-surface)',
            border: '2px solid var(--color-amber-400)',
            borderRadius: '1.25rem',
            padding: '2rem 2rem 1.75rem',
            maxWidth: '24rem',
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 8px 64px rgba(212,137,30,0.4), 0 0 0 1px rgba(212,137,30,0.15)',
            position: 'relative',
            zIndex: 1,
            animation: 'jc-fade-in 0.35s ease-out both',
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ fontSize: 56, lineHeight: 1, marginBottom: '0.75rem' }}>🏅</div>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.25rem',
            fontWeight: 800,
            color: 'var(--text-primary)',
            margin: '0 0 0.75rem',
          }}>
            Congrats! You made it.
          </h2>
          <p style={{
            fontSize: '0.875rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.7,
            margin: '0 0 0.75rem',
          }}>
            Your journey is complete and you're on your way to bot AI mastery. Your guide is now set up for a real journeyman.
          </p>
          <p style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: '0 0 0.5rem',
          }}>
            Now you can:
          </p>
          <ul style={{
            fontSize: '0.8125rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.75,
            margin: '0 0 1.5rem',
            textAlign: 'left',
            paddingLeft: '1.25rem',
          }}>
            <li>Use the guide liberally by pressing the header icon</li>
            <li>Play against your bot and/or put your bot against other bots</li>
            <li>Enter your bot in a tournament by pressing Tournaments in the guide</li>
          </ul>
          <button
            onClick={onDismiss}
            className="btn btn-primary"
            style={{ minWidth: '9rem', fontSize: '0.9375rem' }}
          >
            Let's go! 🚀
          </button>
        </div>
      </div>
    </>
  )
}
