import React from 'react'
import { useSoundStore } from '../../store/soundStore.js'

export default function MuteToggle() {
  const { muted, toggleMute } = useSoundStore()

  return (
    <button
      onClick={toggleMute}
      aria-label={muted ? 'Unmute' : 'Mute'}
      className="w-8 h-8 flex items-center justify-center rounded-full text-sm transition-colors hover:bg-[var(--bg-surface-hover)]"
      style={{ color: 'var(--text-secondary)' }}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  )
}
