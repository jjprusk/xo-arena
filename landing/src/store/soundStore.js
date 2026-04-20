// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Landing site uses Web Audio synthesis only — no Howler/file dependency.
export const SOUND_PACKS = [
  { id: 'retro',  label: 'Retro',  description: '8-bit arcade style' },
  { id: 'nature', label: 'Nature', description: 'Soft ambient sounds' },
]

// ── Web Audio synthesis ───────────────────────────────────────────────────────
let _audioCtx = null
let _masterGain = null
let _synthVolume = 0.15

function resumeCtx() {
  if (_audioCtx && _audioCtx.state !== 'running') _audioCtx.resume().catch(() => {})
}

function ctx() {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    _masterGain = _audioCtx.createGain()
    _masterGain.gain.value = _synthVolume
    _masterGain.connect(_audioCtx.destination)
  }
  resumeCtx()
  return _audioCtx
}

// Pre-warm AudioContext on pointer interaction (capture phase fires before component handlers).
// Also CREATE the context here if it doesn't exist yet — creating it inside a user gesture
// ensures the browser starts it in 'running' state. Without this, the first sound call
// creates the context outside a gesture (e.g. on game:start) and it starts suspended.
if (typeof window !== 'undefined') {
  document.addEventListener('pointerdown', () => {
    if (!_audioCtx || _audioCtx.state === 'closed') { ctx() } else { resumeCtx() }
  }, { capture: true, passive: true })

  // Resume when the window regains focus (macOS window-switch suspends the context
  // without triggering visibilitychange, so we need both events).
  window.addEventListener('focus', resumeCtx)

  // Resume on tab-show: PvP socket events (opponent moves) fire without any user
  // gesture, so the pointerdown listener won't pre-warm in time.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumeCtx()
  })
}

const LOOKAHEAD = 0.05

function tone(ac, type, freq, startTime, duration, gain = 0.18, fadeOut = true) {
  const osc = ac.createOscillator()
  const env = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, startTime)
  env.gain.setValueAtTime(gain, startTime)
  if (fadeOut) env.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  osc.connect(env)
  env.connect(_masterGain)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.02)
}

const SYNTH = {
  retro: {
    move()    { const ac = ctx(); const t = ac.currentTime + LOOKAHEAD; tone(ac, 'square', 330, t, 0.08, 0.15); tone(ac, 'square', 440, t + 0.05, 0.07, 0.12) },
    win()     { const ac = ctx(); const t = ac.currentTime + LOOKAHEAD; [523, 659, 784, 1047].forEach((f, i) => tone(ac, 'square', f, t + i * 0.1, 0.15, 0.15)) },
    draw()    { const ac = ctx(); const t = ac.currentTime + LOOKAHEAD; tone(ac, 'square', 440, t, 0.1, 0.15); tone(ac, 'square', 330, t + 0.12, 0.1, 0.12) },
    forfeit() { const ac = ctx(); const t = ac.currentTime + LOOKAHEAD; tone(ac, 'square', 330, t, 0.12, 0.15); tone(ac, 'square', 220, t + 0.14, 0.18, 0.15); tone(ac, 'square', 165, t + 0.30, 0.22, 0.12) },
  },
  nature: {
    move()    { const ac = ctx(); const t = ac.currentTime + LOOKAHEAD; tone(ac, 'sine', 528, t, 0.18, 0.12); tone(ac, 'sine', 792, t + 0.02, 0.12, 0.08) },
    win()     { const ac = ctx(); const t = ac.currentTime + LOOKAHEAD; [528, 660, 792, 1056].forEach((f, i) => { tone(ac, 'sine', f, t + i * 0.14, 0.28, 0.14); tone(ac, 'sine', f * 1.5, t + i * 0.14, 0.20, 0.06) }) },
    draw()    { const ac = ctx(); const t = ac.currentTime + LOOKAHEAD; tone(ac, 'sine', 440, t, 0.25, 0.10); tone(ac, 'sine', 528, t + 0.05, 0.20, 0.08) },
    forfeit() {
      const ac = ctx(); const t = ac.currentTime + LOOKAHEAD
      const osc = ac.createOscillator(); const env = ac.createGain()
      osc.type = 'sine'; osc.frequency.setValueAtTime(330, t); osc.frequency.exponentialRampToValueAtTime(165, t + 0.5)
      env.gain.setValueAtTime(0.14, t); env.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
      osc.connect(env); env.connect(_masterGain); osc.start(t); osc.stop(t + 0.55)
    },
  },
}

// ── Store ─────────────────────────────────────────────────────────────────────
export const useSoundStore = create(
  persist(
    (set, get) => ({
      muted: false,
      volume: 0.15,
      soundPack: 'retro',

      toggleMute() {
        set({ muted: !get().muted })
      },

      setVolume(v) {
        _synthVolume = v
        if (_masterGain) _masterGain.gain.value = v
        set({ volume: v })
      },

      setSoundPack(pack) {
        set({ soundPack: pack })
      },

      play(key) {
        const { muted, soundPack } = get()
        if (muted) return
        // Debug trace — enable via `window.__debugSound = true` in DevTools console
        if (typeof window !== 'undefined' && window.__debugSound) {
          // eslint-disable-next-line no-console
          console.trace(`[sound] play('${key}')`)
        }
        // Fallback to 'retro' if stored pack is invalid (e.g. 'default' from frontend)
        const pack = SYNTH[soundPack] ? soundPack : 'retro'
        SYNTH[pack][key]?.()
      },
    }),
    {
      name: 'xo-sound',
      version: 1,
      // Migrate old persisted state: 'default' pack was removed; map it to 'retro'.
      migrate: (old) => ({
        ...old,
        soundPack: ['retro', 'nature'].includes(old?.soundPack) ? old.soundPack : 'retro',
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.volume != null) _synthVolume = state.volume
      },
    },
  ),
)
