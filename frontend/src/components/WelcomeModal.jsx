import React, { useEffect } from 'react'

export default function WelcomeModal({ isOpen, onClose, onSignIn }) {
  useEffect(() => {
    if (!isOpen) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onMouseDown={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl overflow-hidden"
        style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)' }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Gradient header band */}
        <div
          className="px-8 pt-8 pb-6 text-center"
          style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e3a5f 100%)' }}
        >
          <div className="text-5xl mb-3">🎮</div>
          <h2
            className="text-2xl font-bold tracking-tight mb-1"
            style={{ color: '#f9fafb', fontFamily: 'var(--font-display)' }}
          >
            Welcome to XO Arena
          </h2>
          <p className="text-sm" style={{ color: '#a5b4fc' }}>
            A competitive tic-tac-toe platform with real ML bots and ELO rankings
          </p>
        </div>

        {/* Body */}
        <div
          className="px-8 py-6 space-y-5"
          style={{ backgroundColor: 'var(--bg-surface)' }}
        >
          {/* Play now — free */}
          <div className="flex gap-3 items-start">
            <span className="text-2xl mt-0.5">⊞</span>
            <div>
              <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                Play right now — no account needed
              </p>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                Jump straight into games against our built-in AI bots at any skill level.
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px" style={{ backgroundColor: 'var(--border-default)' }} />

          {/* Full experience */}
          <div className="flex gap-3 items-start">
            <span className="text-2xl mt-0.5">🤖</span>
            <div>
              <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                Create an account to unlock everything
              </p>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                Build and train your own ML bot, earn an ELO ranking, track your stats,
                and compete on the leaderboard.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onSignIn}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all hover:brightness-110 active:scale-[0.97]"
              style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))', color: 'white' }}
            >
              Create account / Sign in
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-colors hover:bg-[var(--bg-surface-hover)] active:scale-[0.97]"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
            >
              Play as guest
            </button>
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-4 text-2xl leading-none transition-opacity hover:opacity-70"
          style={{ color: 'rgba(255,255,255,0.4)' }}
          aria-label="Close"
        >
          ×
        </button>
      </div>
    </div>
  )
}
