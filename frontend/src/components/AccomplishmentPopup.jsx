import React from 'react'

const TYPE_TITLES = {
  // New registry keys (bus)
  'achievement.tier_upgrade':    'Tier Upgrade!',
  'achievement.milestone':       'Activity Milestone',
  'system.alert':                'System Alert',
  'system.alert.cleared':        'All Clear',
  'match.ready':                 'Match Ready',
  'match.result':                'Match Result',
  // Legacy keys (persisted notifications before bus migration)
  'tier_upgrade':                'Tier Upgrade!',
  'first_hpc':                   'First PvP Credit',
  'first_bpc':                   'First Bot Credit',
  'first_tc':                    'First Tournament Credit',
  'credit_milestone':            'Activity Milestone',
  'system_alert':                'System Alert',
  'tournament_match_result':     'Match Result',
}

const TYPE_ICONS = {
  'achievement.tier_upgrade':    null,   // use payload.tierIcon
  'achievement.milestone':       '⭐',
  'system.alert':                '⚠️',
  'system.alert.cleared':        '✅',
  'match.ready':                 '🎮',
  'match.result':                '🏆',
  // Legacy
  'tier_upgrade':                null,
  'first_hpc':                   '🎮',
  'first_bpc':                   '🤖',
  'first_tc':                    '🏆',
  'credit_milestone':            '⭐',
  'system_alert':                '⚠️',
  'tournament_match_result':     '🏆',
}

/**
 * Celebratory popup for a single accomplishment notification.
 * Rendered by AppLayout — shows one at a time from the accomplishments queue.
 */
export default function AccomplishmentPopup({ notification, onDismiss }) {
  if (!notification) return null

  const { type, payload } = notification
  const icon  = (type === 'tier_upgrade' || type === 'achievement.tier_upgrade')
    ? payload.tierIcon
    : (TYPE_ICONS[type] ?? '🎉')
  const title = TYPE_TITLES[type] ?? 'Achievement Unlocked'
  const message = payload?.message ?? ''

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
      data-testid="accomplishment-popup"
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-6 space-y-4 text-center"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div className="text-5xl select-none" aria-hidden="true">{icon}</div>
        <div>
          <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{title}</p>
          {message && (
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{message}</p>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="w-full py-2.5 rounded-xl font-semibold text-sm transition-all hover:brightness-110 active:scale-[0.97]"
          style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))', color: 'white' }}
        >
          Got it!
        </button>
      </div>
    </div>
  )
}
