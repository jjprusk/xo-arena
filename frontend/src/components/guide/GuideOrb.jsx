// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { useGuideStore } from '../../store/guideStore.js'
import { useIsInGame } from '../../lib/useIsInGame.js'

const BTN   = 44                   // button diameter (px)
const RING_R = 19                  // radius — leaves ~3px margin for 2.5px stroke
const RING_C = BTN / 2             // cx/cy = 22 (true centre of 44×44)
const CIRCUMFERENCE = 2 * Math.PI * RING_R

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

  const journeyDone    = !!journeyProgress?.dismissedAt
  const completedSteps = journeyProgress?.completedSteps?.length ?? 0
  const totalSteps     = 8
  const dashOffset     = CIRCUMFERENCE * (1 - completedSteps / totalSteps)

  const urgent   = hasUrgent
  const orbStyle = urgent
    ? { background: 'linear-gradient(135deg, var(--color-amber-500), var(--color-amber-700))', boxShadow: '0 0 0 2px rgba(212,137,30,0.4)' }
    : { background: 'linear-gradient(135deg, #5B82B8, #3A5E8E)', boxShadow: '0 0 0 2px rgba(255,255,255,0.15)' }

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
        {/* SVG progress ring — hidden after journey is dismissed */}
        {!journeyDone && (
          <svg
            width={BTN}
            height={BTN}
            viewBox={`0 0 ${BTN} ${BTN}`}
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
        )}

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
