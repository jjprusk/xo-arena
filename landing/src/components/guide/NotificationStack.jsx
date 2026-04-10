import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGuideStore } from '../../store/guideStore.js'

const TYPE_CONFIG = {
  tournament:  { label: 'Tournament',  color: 'var(--color-blue-600)',   bg: 'var(--color-blue-50)',   darkBg: '#1a2535' },
  flash:       { label: 'Flash',       color: 'var(--color-amber-600)',  bg: 'var(--color-amber-50)',  darkBg: '#3a2e1a' },
  match_ready: { label: 'Match',       color: 'var(--color-slate-500)',  bg: 'var(--color-slate-50)',  darkBg: '#1e2535' },
  admin:       { label: 'Admin',       color: 'var(--color-blue-500)',   bg: 'var(--color-blue-50)',   darkBg: '#1a2535' },
  invite:      { label: 'Invite',      color: 'var(--color-teal-500)',   bg: 'var(--color-teal-50)',   darkBg: '#1a2e2a' },
  room_invite: { label: 'Room Invite', color: 'var(--color-teal-500)',   bg: 'var(--color-teal-50)',   darkBg: '#1a2e2a' },
}

const MAX_VISIBLE = 3

function NotificationCard({ notif, onDismiss }) {
  const [leaving, setLeaving] = useState(false)
  const cfg = TYPE_CONFIG[notif.type] ?? TYPE_CONFIG.match_ready
  const navigate = useNavigate()

  function handleDismiss() {
    setLeaving(true)
    setTimeout(() => onDismiss(notif.id), 220)
  }

  function handleClick() {
    if (!notif.href) return
    handleDismiss()
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
        transition: 'opacity 0.2s, transform 0.2s',
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'translateX(16px)' : 'translateX(0)',
        cursor: notif.href ? 'pointer' : 'default',
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
        onClick={e => { e.stopPropagation(); handleDismiss() }}
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

  const visible  = notifications.slice(0, MAX_VISIBLE)
  const overflow = notifications.length - MAX_VISIBLE

  return (
    <section aria-label="Notifications">
      <div className="flex flex-col gap-2">
        {notifications.length === 0 ? (
          <p className="text-xs text-center py-1" style={{ color: 'var(--text-muted)' }}>
            — no messages —
          </p>
        ) : (
          <>
            {visible.map(n => (
              <NotificationCard key={n.id} notif={n} onDismiss={dismissNotification} />
            ))}
            {overflow > 0 && (
              <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
                +{overflow} more notification{overflow !== 1 ? 's' : ''}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}
