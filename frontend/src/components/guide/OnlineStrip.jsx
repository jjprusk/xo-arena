import React from 'react'

const MAX_AVATARS = 6

// Distinct avatar background colors cycling by index
const AVATAR_COLORS = [
  '#4A6FA5', '#24B587', '#7C5CBF', '#E85554', '#D4891E', '#304D77',
]

export default function OnlineStrip({ onlineUsers = [] }) {
  const visible  = onlineUsers.slice(0, MAX_AVATARS)
  const overflow = onlineUsers.length - MAX_AVATARS

  return (
    <section
      aria-label="Online players"
      className="shrink-0 px-4 py-2"
      style={{ borderBottom: '1px solid var(--border-default)' }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {/* Pulsing green dot */}
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#22c55e',
              animation: 'guide-online-pulse 2.5s ease-in-out infinite',
            }}
          />
          Online now
        </span>
        {onlineUsers.length > 0 && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {onlineUsers.length} {onlineUsers.length === 1 ? 'player' : 'players'}
          </span>
        )}
      </div>

      {/* Avatars or empty state */}
      {onlineUsers.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>— nobody online —</p>
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap">
          {visible.map((user, i) => (
            <button
              key={user.id}
              title={`@${user.username ?? user.displayName}`}
              aria-label={`Invite ${user.displayName} to your room`}
              className="relative shrink-0 rounded-full flex items-center justify-center text-white font-bold"
              style={{
                width: 34,
                height: 34,
                fontSize: '0.7rem',
                background: user.avatarColor ?? AVATAR_COLORS[i % AVATAR_COLORS.length],
                border: '2px solid var(--bg-surface)',
                cursor: 'pointer',
                transition: 'transform 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.12)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(74,111,165,0.3)' }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}
            >
              {user.avatarUrl
                ? <img src={user.avatarUrl} alt={user.displayName} className="rounded-full w-full h-full object-cover" />
                : (user.displayName?.[0] ?? '?').toUpperCase()
              }
              {/* Green status dot */}
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: user.inMatch ? 'var(--color-amber-500)' : '#22c55e',
                  border: '2px solid var(--bg-surface)',
                }}
              />
            </button>
          ))}
          {overflow > 0 && (
            <span className="text-xs px-1" style={{ color: 'var(--text-muted)' }}>+{overflow} more</span>
          )}
        </div>
      )}

      {/* Keyframe injected once */}
      <style>{`
        @keyframes guide-online-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
    </section>
  )
}
