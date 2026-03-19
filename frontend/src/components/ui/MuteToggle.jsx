import React from 'react'
import { useSoundStore } from '../../store/soundStore.js'

export default function MuteToggle() {
  const { muted, toggleMute } = useSoundStore()

  return (
    <div
      className="flex items-center rounded-full border overflow-hidden"
      style={{ borderColor: 'var(--border-default)' }}
    >
      <button
        onClick={() => muted && toggleMute()}
        aria-label="Sound on"
        className={`px-2 py-1 text-sm transition-colors ${
          !muted
            ? 'bg-[var(--color-blue-600)] text-white'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
      >
        🔊
      </button>
      <button
        onClick={() => !muted && toggleMute()}
        aria-label="Sound off"
        className={`px-2 py-1 text-sm transition-colors ${
          muted
            ? 'bg-[var(--color-blue-600)] text-white'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
      >
        🔇
      </button>
    </div>
  )
}
