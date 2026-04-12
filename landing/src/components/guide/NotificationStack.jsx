import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGuideStore } from '../../store/guideStore.js'

const TYPE_CONFIG = {
  tournament:  { label: 'Tournament',  color: 'var(--color-blue-600)',   bg: 'var(--color-blue-50)'  },
  flash:       { label: 'Flash',       color: 'var(--color-amber-600)',  bg: 'var(--color-amber-50)' },
  match_ready: { label: 'Match',       color: 'var(--color-slate-500)',  bg: 'var(--color-slate-50)' },
  admin:       { label: 'Admin',       color: 'var(--color-blue-500)',   bg: 'var(--color-blue-50)'  },
  invite:      { label: 'Invite',      color: 'var(--color-teal-500)',   bg: 'var(--color-teal-50)'  },
  room_invite: { label: 'Room Invite', color: 'var(--color-teal-500)',   bg: 'var(--color-teal-50)'  },
}

function NotificationCard({ notif, onDismiss }) {
  const navigate = useNavigate()
  const cfg = TYPE_CONFIG[notif.type] ?? TYPE_CONFIG.match_ready

  function handleDismiss(e) {
    e.stopPropagation()
    onDismiss(notif.id)
  }

  function handleClick() {
    if (!notif.href) return
    onDismiss(notif.id)
    navigate(notif.href)
  }

  return (
    <div
      role="listitem"
      onClick={notif.href ? handleClick : undefined}
      style={{
        borderLeft: `3px solid ${cfg.color}`,
        backgroundColor: 'var(--bg-surface)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-card)',
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        cursor: notif.href ? 'pointer' : 'default',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* Type chip */}
      <span
        className="text-xs font-semibold rounded-sm px-1.5 py-0.5 shrink-0"
        style={{ color: cfg.color, backgroundColor: cfg.bg, marginTop: 1 }}
      >
        {cfg.label}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
          {notif.title}
        </p>
        {notif.body && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {notif.body}
          </p>
        )}
        {notif.href && (
          <p className="text-[10px] mt-1 font-medium" style={{ color: cfg.color }}>
            View →
          </p>
        )}
      </div>

      {/* Dismiss */}
      <button
        onClick={handleDismiss}
        aria-label="Dismiss notification"
        className="shrink-0 text-lg leading-none hover:opacity-60 transition-opacity"
        style={{ color: 'var(--text-muted)', marginTop: -2 }}
      >
        ×
      </button>
    </div>
  )
}

export default function NotificationStack() {
  const { notifications, dismissNotification } = useGuideStore()
  const [index, setIndex]     = useState(0)
  const [animDir, setAnimDir] = useState(null) // 'left' | 'right' | null
  const touchStartX           = useRef(null)
  const animTimer             = useRef(null)

  // Filter out expired notifications at render time (in-session TTL enforcement)
  const now = Date.now()
  const active = notifications.filter(n => !n.expiresAt || new Date(n.expiresAt).getTime() > now)

  const total     = active.length
  const safeIndex = total === 0 ? 0 : Math.min(index, total - 1)

  // Keep index in bounds when notifications are dismissed
  useEffect(() => {
    if (index >= total && total > 0) setIndex(total - 1)
  }, [total]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup animation timer on unmount
  useEffect(() => () => clearTimeout(animTimer.current), [])

  // Periodic expiry sweep — auto-dismiss notifications whose TTL has passed
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      useGuideStore.getState().notifications
        .filter(n => n.expiresAt && new Date(n.expiresAt).getTime() <= now)
        .forEach(n => useGuideStore.getState().dismissNotification(n.id))
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  if (total === 0) {
    return (
      <section aria-label="Notifications">
        <p className="text-xs text-center py-1" style={{ color: 'var(--text-muted)' }}>
          — no messages —
        </p>
      </section>
    )
  }

  function goTo(nextIndex, dir) {
    if (nextIndex === safeIndex || animDir) return
    setAnimDir(dir)
    clearTimeout(animTimer.current)
    animTimer.current = setTimeout(() => {
      setIndex(nextIndex)
      setAnimDir(null)
    }, 180)
  }

  function prev() { if (safeIndex > 0) goTo(safeIndex - 1, 'right') }
  function next() { if (safeIndex < total - 1) goTo(safeIndex + 1, 'left') }

  function handleDismiss(id) {
    // Step back if dismissing the last card
    if (safeIndex >= total - 1 && total > 1) setIndex(total - 2)
    dismissNotification(id)
  }

  // Touch swipe handlers
  function onTouchStart(e) {
    touchStartX.current = e.touches[0].clientX
  }
  function onTouchEnd(e) {
    if (touchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (dx > 40) prev()
    else if (dx < -40) next()
  }

  const notif = active[safeIndex]

  // Slide-fade animation: card exits in the direction of travel, enters from opposite
  const cardStyle = {
    transition: animDir ? 'opacity 0.18s ease, transform 0.18s ease' : 'none',
    opacity:   animDir ? 0 : 1,
    transform: animDir === 'left'  ? 'translateX(-14px)'
             : animDir === 'right' ? 'translateX(14px)'
             : 'translateX(0)',
  }

  return (
    <section aria-label="Notifications">
      {/* Swipeable card area */}
      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{ touchAction: 'pan-y' }} // allow vertical scroll, intercept horizontal
      >
        <div style={cardStyle}>
          <NotificationCard key={notif.id} notif={notif} onDismiss={handleDismiss} />
        </div>
      </div>

      {/* Carousel controls — only when more than one notification */}
      {total > 1 && (
        <div className="flex items-center justify-between mt-2 px-0.5">
          {/* Prev */}
          <button
            onClick={prev}
            disabled={safeIndex === 0}
            aria-label="Previous notification"
            style={{
              fontSize: 20,
              lineHeight: 1,
              padding: '0 4px',
              color: safeIndex === 0 ? 'var(--border-default)' : 'var(--text-secondary)',
              cursor: safeIndex === 0 ? 'default' : 'pointer',
              background: 'none',
              border: 'none',
            }}
          >
            ‹
          </button>

          {/* Dot indicators (≤7) or numeric counter (>7) */}
          {total <= 7 ? (
            <div className="flex items-center gap-1.5">
              {active.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goTo(i, i < safeIndex ? 'right' : 'left')}
                  aria-label={`Notification ${i + 1} of ${total}`}
                  aria-current={i === safeIndex}
                  style={{
                    width:           i === safeIndex ? 8 : 6,
                    height:          i === safeIndex ? 8 : 6,
                    borderRadius:    '50%',
                    backgroundColor: i === safeIndex ? 'var(--color-slate-500)' : 'var(--border-default)',
                    border:          'none',
                    padding:         0,
                    cursor:          'pointer',
                    transition:      'all 0.15s',
                    flexShrink:      0,
                  }}
                />
              ))}
            </div>
          ) : (
            <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {safeIndex + 1} / {total}
            </span>
          )}

          {/* Next */}
          <button
            onClick={next}
            disabled={safeIndex === total - 1}
            aria-label="Next notification"
            style={{
              fontSize: 20,
              lineHeight: 1,
              padding: '0 4px',
              color: safeIndex === total - 1 ? 'var(--border-default)' : 'var(--text-secondary)',
              cursor: safeIndex === total - 1 ? 'default' : 'pointer',
              background: 'none',
              border: 'none',
            }}
          >
            ›
          </button>
        </div>
      )}
    </section>
  )
}
