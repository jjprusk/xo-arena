// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { useSoundStore } from '../../store/soundStore.js'

export default function MuteToggle() {
  const { muted, toggleMute } = useSoundStore()

  return (
    <button
      onClick={toggleMute}
      aria-label={muted ? 'Unmute sound' : 'Mute sound'}
      aria-pressed={muted}
      className="px-2 py-1 text-sm rounded-lg transition-colors hover:bg-[var(--bg-surface-hover)]"
      style={{ color: muted ? 'var(--text-muted)' : 'var(--text-primary)' }}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  )
}
