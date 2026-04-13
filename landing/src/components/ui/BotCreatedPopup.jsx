import React from 'react'

const BALLOON_CONFIGS = [
  { left: '8%',  size: 48, dur: 2.8, delay: 0   },
  { left: '22%', size: 56, dur: 3.2, delay: 0.15 },
  { left: '38%', size: 44, dur: 2.6, delay: 0.3  },
  { left: '54%', size: 52, dur: 3.0, delay: 0.1  },
  { left: '70%', size: 48, dur: 2.9, delay: 0.25 },
  { left: '84%', size: 44, dur: 3.4, delay: 0.05 },
]

export default function BotCreatedPopup({ onDismiss }) {
  return (
    <>
      <style>{`
        @keyframes bot-balloon-rise {
          0%   { transform: translateY(0) rotate(-6deg); opacity: 1; }
          80%  { opacity: 1; }
          100% { transform: translateY(-110vh) rotate(6deg); opacity: 0; }
        }
      `}</style>

      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 70,
          backgroundColor: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(2px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '1rem',
          overflow: 'hidden',
        }}
        onClick={onDismiss}
      >
        {/* Floating balloons */}
        {BALLOON_CONFIGS.map((b, i) => (
          <div key={i} style={{
            position: 'absolute',
            bottom: '-8%',
            left: b.left,
            fontSize: b.size,
            lineHeight: 1,
            pointerEvents: 'none',
            animation: `bot-balloon-rise ${b.dur}s ease-in ${b.delay}s forwards`,
          }}>🎈</div>
        ))}

        {/* Card */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Bot created"
          style={{
            background: 'var(--bg-surface)',
            border: '1.5px solid var(--color-amber-400)',
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
          <div style={{ fontSize: 52, lineHeight: 1, marginBottom: '0.75rem' }}>🤖</div>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.1rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            margin: '0 0 0.625rem',
          }}>
            Congrats on creating your first bot!
          </h2>
          <p style={{
            fontSize: '0.875rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.65,
            margin: '0 0 1.5rem',
          }}>
            Now take your bot to the gym and make that bot a real player!
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
    </>
  )
}
