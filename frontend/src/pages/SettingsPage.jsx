import React from 'react'
import { useThemeStore } from '../store/themeStore.js'
import { useSoundStore, SOUND_PACKS } from '../store/soundStore.js'

const THEMES = [
  { value: 'light', label: 'Light', preview: '☀' },
  { value: 'dark', label: 'Dark', preview: '☾' },
  { value: 'system', label: 'System', preview: '⊙' },
]

export default function SettingsPage() {
  const { theme, setTheme } = useThemeStore()
  const { muted, toggleMute, volume, setVolume, soundPack, setSoundPack } = useSoundStore()

  return (
    <div className="max-w-lg mx-auto space-y-8">
      <PageHeader title="Settings" />

      {/* Appearance */}
      <section className="space-y-3">
        <SectionLabel>Appearance</SectionLabel>
        <div className="flex gap-3">
          {THEMES.map(({ value, label, preview }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all active:scale-[0.97] ${
                theme === value
                  ? 'border-[var(--color-blue-600)] bg-[var(--color-blue-50)]'
                  : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--color-gray-400)]'
              }`}
              style={{ boxShadow: 'var(--shadow-card)' }}
            >
              <span className="text-2xl">{preview}</span>
              <span className="text-sm font-medium">{label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* About */}
      <section className="space-y-3">
        <SectionLabel>About</SectionLabel>
        <div
          className="rounded-xl border p-5 flex items-center justify-between"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
        >
          <span className="font-medium">XO Arena</span>
          <span className="text-sm font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
            v{import.meta.env.VITE_APP_VERSION}
          </span>
        </div>
      </section>

      {/* Sound */}
      <section className="space-y-3">
        <SectionLabel>Sound</SectionLabel>
        <div
          className="rounded-xl border p-5 space-y-5"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">Master sound</span>
            <button
              onClick={toggleMute}
              className={`relative w-12 h-6 rounded-full transition-colors ${muted ? 'bg-[var(--color-gray-300)]' : 'bg-[var(--color-blue-600)]'}`}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${muted ? 'left-1' : 'left-7'}`} />
            </button>
          </div>
          <div className="h-px" style={{ backgroundColor: 'var(--border-default)' }} />
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium w-14" style={{ color: 'var(--text-secondary)' }}>Volume</span>
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
            <span className="text-sm font-semibold tabular-nums w-10 text-right" style={{ color: 'var(--text-secondary)' }}>
              {Math.round(volume * 100)}%
            </span>
          </div>
          <div className="h-px" style={{ backgroundColor: 'var(--border-default)' }} />
          <div>
            <span className="text-sm font-medium block mb-2">Sound pack</span>
            <div className="flex flex-col gap-2">
              {SOUND_PACKS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSoundPack(p.id)}
                  className="flex items-center justify-between px-3 py-2 rounded-lg border-2 text-sm text-left transition-colors"
                  style={{
                    borderColor: soundPack === p.id ? 'var(--color-blue-600)' : 'var(--border-default)',
                    backgroundColor: soundPack === p.id ? 'var(--color-blue-50)' : 'var(--bg-surface)',
                  }}
                >
                  <span className="font-medium">{p.label}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{p.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function PageHeader({ title }) {
  return (
    <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
      <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>{title}</h1>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
      {children}
    </h2>
  )
}
