// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ── Sound types ───────────────────────────────────────────────────────────────
export const NOTIF_SOUND_TYPES = [
  { id: 'ding',  label: 'Ding',  description: 'Single bell tone' },
  { id: 'chime', label: 'Chime', description: 'Ascending two-note' },
  { id: 'blip',  label: 'Blip',  description: 'Short retro beep' },
]

// ── Web Audio synthesis ───────────────────────────────────────────────────────
let _audioCtx = null

function ctx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {})
  return _audioCtx
}

// Pre-warm AudioContext on every pointer interaction (capture phase) to avoid
// async-resume lag when the notification sound fires.
if (typeof window !== 'undefined') {
  document.addEventListener('pointerdown', () => {
    if (_audioCtx?.state === 'suspended') _audioCtx.resume().catch(() => {})
  }, { capture: true, passive: true })
}

const LOOKAHEAD = 0.05

function tone(ac, freq, startTime, duration, gain = 0.18, type = 'sine') {
  const osc = ac.createOscillator()
  const env = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, startTime)
  env.gain.setValueAtTime(gain, startTime)
  env.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  osc.connect(env)
  env.connect(ac.destination)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.02)
}

const SOUNDS = {
  ding() {
    const ac = ctx(); const t = ac.currentTime + LOOKAHEAD
    tone(ac, 880, t,        0.35, 0.20, 'sine')
    tone(ac, 1760, t + 0.01, 0.20, 0.06, 'sine')
  },
  chime() {
    const ac = ctx(); const t = ac.currentTime + LOOKAHEAD
    tone(ac, 660, t,        0.25, 0.18, 'sine')
    tone(ac, 990, t + 0.15, 0.35, 0.18, 'sine')
  },
  blip() {
    const ac = ctx(); const t = ac.currentTime + LOOKAHEAD
    tone(ac, 440, t,       0.06, 0.20, 'square')
    tone(ac, 660, t + 0.07, 0.06, 0.15, 'square')
  },
}

// ── Store ─────────────────────────────────────────────────────────────────────
export const useNotifSoundStore = create(
  persist(
    (set, get) => ({
      enabled: true,
      type: 'ding',

      setEnabled(enabled) { set({ enabled }) },
      setType(type)       { set({ type }) },

      play() {
        const { enabled, type } = get()
        if (!enabled) return
        try {
          SOUNDS[type]?.()
        } catch { /* non-fatal — audio may be unavailable */ }
      },
    }),
    { name: 'xo-notif-sound' },
  ),
)
