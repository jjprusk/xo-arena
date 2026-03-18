import React from 'react'
import { useThemeStore } from '../store/themeStore.js'
import { useSoundStore } from '../store/soundStore.js'

const THEMES = [
  { value: 'light', label: 'Light', preview: '☀' },
  { value: 'dark', label: 'Dark', preview: '☾' },
  { value: 'system', label: 'System', preview: '⊙' },
]

export default function SettingsPage() {
  const { theme, setTheme } = useThemeStore()
  const { muted, toggleMute, volume, setVolume } = useSoundStore()

  return (
    <div className="max-w-lg mx-auto space-y-8">
      <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
        Settings
      </h1>

      {/* Appearance */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>
          Appearance
        </h2>
        <div className="flex gap-3">
          {THEMES.map(({ value, label, preview }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors ${
                theme === value
                  ? 'border-[var(--color-blue-600)] bg-[var(--color-blue-50)]'
                  : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--color-gray-400)]'
              }`}
            >
              <span className="text-2xl">{preview}</span>
              <span className="text-sm font-medium">{label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Sound */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>
          Sound
        </h2>
        <div className="rounded-xl border p-4 space-y-4" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}>
          <div className="flex items-center justify-between">
            <span className="font-medium">Master sound</span>
            <button
              onClick={toggleMute}
              className={`relative w-12 h-6 rounded-full transition-colors ${muted ? 'bg-[var(--color-gray-300)]' : 'bg-[var(--color-blue-600)]'}`}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${muted ? 'left-1' : 'left-7'}`}
              />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Volume</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="flex-1 accent-[var(--color-blue-600)]"
              disabled={muted}
            />
            <span className="text-sm w-8 text-right" style={{ color: 'var(--text-secondary)' }}>
              {Math.round(volume * 100)}%
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
