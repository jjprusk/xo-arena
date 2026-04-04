import React, { useEffect, useState } from 'react'
import { usePvpStore } from '../../store/pvpStore.js'

/**
 * "Still Active?" popup — shown when the server issues an idle:warning.
 * Counts down from secondsRemaining to 0. User clicks "Still Active?" to reset.
 * Dismisses automatically when the server resets the timer (idleWarning becomes null).
 */
export default function IdleWarningPopup() {
  const idleWarning = usePvpStore(s => s.idleWarning)
  const idlePong = usePvpStore(s => s.idlePong)
  const [remaining, setRemaining] = useState(null)

  // Sync countdown from server value whenever the warning arrives/updates
  useEffect(() => {
    if (idleWarning == null) { setRemaining(null); return }
    setRemaining(idleWarning.secondsRemaining)
  }, [idleWarning])

  // Tick down every second
  useEffect(() => {
    if (remaining == null || remaining <= 0) return
    const id = setInterval(() => setRemaining(r => (r != null ? Math.max(0, r - 1) : null)), 1000)
    return () => clearInterval(id)
  }, [remaining])

  if (idleWarning == null) return null

  const urgent = remaining != null && remaining <= 30
  const fraction = remaining != null && idleWarning.secondsRemaining > 0
    ? remaining / idleWarning.secondsRemaining
    : 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
    >
      <div
        className="rounded-2xl border p-6 flex flex-col items-center gap-4 max-w-xs w-full mx-4 shadow-2xl"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
      >
        <div className="text-3xl">💤</div>

        <div className="text-center space-y-1">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Still Active?
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            You've been quiet for a while. Click below to stay in the room.
          </p>
        </div>

        {/* Countdown */}
        <div className="flex flex-col items-center gap-1 w-full">
          <span
            className="text-2xl font-bold tabular-nums transition-colors"
            style={{ color: urgent ? 'var(--color-red-500)' : 'var(--text-primary)' }}
          >
            {remaining ?? '—'}s
          </span>
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-default)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(0, fraction * 100).toFixed(1)}%`,
                backgroundColor: urgent ? 'var(--color-red-500)' : 'var(--color-blue-500)',
              }}
            />
          </div>
        </div>

        <button
          onClick={idlePong}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
        >
          Still Active!
        </button>
      </div>
    </div>
  )
}
