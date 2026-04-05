import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useThemeStore } from '../store/themeStore.js'
import { useSoundStore, SOUND_PACKS } from '../store/soundStore.js'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { getToken } from '../lib/getToken.js'
import { api } from '../lib/api.js'
import { usePrefsStore } from '../store/prefsStore.js'

const THEMES = [
  { value: 'light', label: 'Light', preview: '☀' },
  { value: 'dark', label: 'Dark', preview: '☾' },
  { value: 'system', label: 'System', preview: '⊙' },
]


export default function SettingsPage() {
  const { theme, setTheme } = useThemeStore()
  const { muted, toggleMute, volume, setVolume, soundPack, setSoundPack, play } = useSoundStore()
  const { data: session } = useOptimisticSession()
  const { showGuideButton, setShowGuideButton } = usePrefsStore()
  const location = useLocation()
  const fromProfile = location.state?.from === '/profile'

  async function handleGuideToggle() {
    const next = !showGuideButton
    setShowGuideButton(next)
    try {
      const token = await getToken()
      await api.users.updatePreferences({ showGuideButton: next }, token)
    } catch {
      setShowGuideButton(!next) // revert on error
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-8">
      {fromProfile && (
        <Link
          to="/profile"
          className="inline-flex items-center gap-1 text-sm font-medium transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-blue-600)' }}
        >
          ‹ Profile
        </Link>
      )}
      <PageHeader title="Settings" />

      {/* Appearance */}
      <section className="space-y-3">
        <SectionLabel>Appearance</SectionLabel>
        <div className="flex gap-3">
          {THEMES.map(({ value, label, preview }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={`flex-1 flex flex-col items-center gap-2 p-3 sm:p-4 rounded-xl border-2 transition-all active:scale-[0.97] ${
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

      {/* Interface (signed-in only) */}
      {session && (
        <section className="space-y-3">
          <SectionLabel>Interface</SectionLabel>
          <div
            className="rounded-xl border p-5"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium">Show Guide button</span>
                <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Display the Guide shortcut in the header</p>
              </div>
              <button
                onClick={handleGuideToggle}
                className={`relative w-12 h-6 rounded-full transition-colors ${showGuideButton ? 'bg-[var(--color-blue-600)]' : 'bg-[var(--color-gray-300)]'}`}
                aria-label={showGuideButton ? 'Hide Guide button' : 'Show Guide button'}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${showGuideButton ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* About */}
      <section className="space-y-3">
        <SectionLabel>About</SectionLabel>
        <div
          className="rounded-xl border p-5 flex items-center justify-between"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">XO Arena</span>
              <span className="text-sm font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
                v{import.meta.env.VITE_APP_VERSION}
              </span>
            </div>
            <div className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              A competitive tic-tac-toe platform with trainable ML models, ELO rankings, and real-time multiplayer.
            </div>
          </div>
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
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Sound pack</span>
              <button
                onClick={() => play('move')}
                className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] active:scale-95 active:opacity-70"
                style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
              >
                ▶ Test sound
              </button>
            </div>
            <select
              value={soundPack}
              onChange={e => setSoundPack(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
            >
              {SOUND_PACKS.map(p => (
                <option key={p.id} value={p.id}>{p.label} — {p.description}</option>
              ))}
            </select>
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
