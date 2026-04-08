import React from 'react'
import { useGuideStore } from '../../store/guideStore.js'
import { useIsInGame } from '../../lib/useIsInGame.js'

const RING_R = 15
const RING_C = RING_R + 3          // cx/cy — centre of SVG viewBox
const CIRCUMFERENCE = 2 * Math.PI * RING_R  // ≈ 94.2

/**
 * GuideOrb — circular nav button with SVG journey-progress ring.
 *
 * States:
 *   idle      — slate gradient, slow pulse
 *   urgent    — amber gradient, fast pulse (unread notifications)
 *   in-game   — amber gradient, fast pulse (never auto-opens panel)
 */
export default function GuideOrb() {
  const { panelOpen, toggle, notifications, journeyProgress } = useGuideStore()
  const isInGame   = useIsInGame()
  const badgeCount = notifications.length
  const hasUrgent  = badgeCount > 0

  const completedSteps = journeyProgress?.completedSteps?.length ?? 0
  const totalSteps     = 7
  const dashOffset     = CIRCUMFERENCE * (1 - completedSteps / totalSteps)

  const urgent   = hasUrgent || isInGame
  const orbStyle = urgent
    ? { background: 'linear-gradient(135deg, var(--color-amber-500), var(--color-amber-700))' }
    : { background: 'linear-gradient(135deg, var(--color-slate-500), var(--color-slate-700))' }

  return (
    <div className="relative" style={{ display: 'inline-flex', alignItems: 'center' }}>
      <button
        onClick={toggle}
        aria-label={panelOpen ? 'Close Guide' : 'Open Guide'}
        aria-expanded={panelOpen}
        aria-haspopup="dialog"
        className={`relative flex items-center justify-center rounded-full transition-opacity hover:opacity-85 active:scale-95 ${urgent ? 'guide-pulse' : ''}`}
        style={{
          ...orbStyle,
          width: 44,
          height: 44,
          minWidth: 44,
          flexShrink: 0,
        }}
      >
        {/* SVG progress ring */}
        <svg
          width={RING_C * 2}
          height={RING_C * 2}
          viewBox={`0 0 ${RING_C * 2} ${RING_C * 2}`}
          className="absolute inset-0"
          aria-hidden="true"
          style={{ transform: 'rotate(-90deg)' }}
        >
          {/* Track */}
          <circle
            cx={RING_C}
            cy={RING_C}
            r={RING_R}
            fill="none"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={2.5}
          />
          {/* Progress arc */}
          {completedSteps > 0 && (
            <circle
              cx={RING_C}
              cy={RING_C}
              r={RING_R}
              fill="none"
              stroke="rgba(255,255,255,0.9)"
              strokeWidth={2.5}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.5s ease' }}
            />
          )}
        </svg>

        {/* Robot emoji centre */}
        <span style={{ fontSize: 18, lineHeight: 1, position: 'relative', zIndex: 1 }}>🤖</span>
      </button>

      {/* Notification badge */}
      {badgeCount > 0 && (
        <span
          aria-label={`${badgeCount} Guide notification${badgeCount !== 1 ? 's' : ''}`}
          className="absolute flex items-center justify-center rounded-full text-white font-bold pointer-events-none"
          style={{
            top: -4,
            right: -4,
            minWidth: 18,
            height: 18,
            fontSize: 10,
            lineHeight: 1,
            padding: '0 4px',
            background: 'var(--color-red-500)',
            border: '2px solid var(--bg-page)',
            zIndex: 10,
          }}
        >
          {badgeCount > 9 ? '9+' : badgeCount}
        </span>
      )}
    </div>
  )
}
