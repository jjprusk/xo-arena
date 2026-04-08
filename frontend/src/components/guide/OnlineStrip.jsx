import React from 'react'

const MAX_AVATARS = 6

/**
 * OnlineStrip — row of online player avatars.
 * amber dot = in-match, green dot = available.
 * Tapping an available player sends a room invite (Phase 4+).
 *
 * For Phase 3 the online list is fetched from the existing leaderboard/users
 * socket presence data. Passed in as `onlineUsers` prop by GuidePanel.
 */
export default function OnlineStrip({ onlineUsers = [] }) {
  if (onlineUsers.length === 0) return null

  const visible  = onlineUsers.slice(0, MAX_AVATARS)
  const overflow = onlineUsers.length - MAX_AVATARS

  return (
    <section aria-label="Online players">
      <p className="text-xs font-semibold uppercase tracking-wider mb-2"
         style={{ color: 'var(--text-muted)' }}>
        Online
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        {visible.map(user => (
          <div key={user.id} className="relative" title={user.displayName}>
            {/* Avatar circle */}
            <div
              className="flex items-center justify-center rounded-full text-xs font-bold"
              style={{
                width: 32,
                height: 32,
                background: 'var(--color-slate-500)',
                color: 'white',
                fontSize: 12,
              }}
            >
              {user.avatarUrl
                ? <img src={user.avatarUrl} alt={user.displayName} className="rounded-full w-full h-full object-cover" />
                : (user.displayName?.[0] ?? '?').toUpperCase()
              }
            </div>
            {/* Status dot */}
            <span
              aria-label={user.inMatch ? 'In match' : 'Available'}
              className="absolute rounded-full border-2"
              style={{
                width: 10,
                height: 10,
                bottom: 0,
                right: 0,
                backgroundColor: user.inMatch ? 'var(--color-amber-500)' : 'var(--color-teal-500)',
                borderColor: 'var(--bg-surface)',
              }}
            />
          </div>
        ))}
        {overflow > 0 && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            +{overflow}
          </span>
        )}
      </div>
    </section>
  )
}
