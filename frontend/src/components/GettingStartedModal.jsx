import React, { useEffect } from 'react'
import { Link } from 'react-router-dom'

const FeedbackIcon = () => (
  <span
    className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs align-middle mx-0.5"
    style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-default)' }}
    aria-label="feedback button"
  >
    💬
  </span>
)

const STEPS = [
  { n: 1, text: <span>Press the <FeedbackIcon /> icon to send feedback anytime</span> },
  { n: 2, text: 'Read the FAQ on the About page' },
  { n: 3, text: 'Play a few games against the built-in bots' },
  { n: 4, text: 'Read the Training Guide on the Gym page' },
  { n: 5, text: 'Create your own bot — give it a name and pick a brain' },
  { n: 6, text: 'Train your bot in the Gym using the Training Guide' },
  { n: 7, text: 'Challenge your bot, then pit your bot against other bots' },
  { n: 8, text: 'Have fun' },
]

export default function GettingStartedModal({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border shadow-xl overflow-hidden"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Getting Started
          </h2>
          <button
            onClick={onClose}
            className="text-lg leading-none hover:opacity-70 transition-opacity"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Steps */}
        <ol className="px-5 py-4 space-y-3">
          {STEPS.map(({ n, text }) => (
            <li key={n} className="flex items-start gap-3">
              <span
                className="mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold"
                style={{ backgroundColor: 'var(--color-blue-600)', color: 'white' }}
              >
                {n}
              </span>
              <span className="text-sm leading-snug" style={{ color: 'var(--text-secondary)' }}>
                {text}
              </span>
            </li>
          ))}
        </ol>

        {/* Footer */}
        <div
          className="px-5 py-3 flex justify-end gap-2"
          style={{ borderTop: '1px solid var(--border-default)' }}
        >
          <Link
            to="/play"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all hover:brightness-110"
            style={{ backgroundColor: 'var(--color-blue-600)', color: 'white' }}
          >
            Play now
          </Link>
        </div>
      </div>
    </div>
  )
}
