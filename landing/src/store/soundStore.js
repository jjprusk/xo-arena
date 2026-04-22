// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Landing site uses Web Audio synthesis only — no Howler/file dependency.
export const SOUND_PACKS = [
  { id: 'retro',  label: 'Retro',  description: '8-bit arcade style' },
  { id: 'nature', label: 'Nature', description: 'Soft ambient sounds' },
]

// ── Web Audio state machine ───────────────────────────────────────────────────
//
// macOS Space switch DOES NOT fire `visibilitychange` (the tab stays "visible"
// per spec, the window is just on another Space). Only `window.focus`/`blur`
// fire reliably. Safari's AudioContext can also end up in `interrupted` state
// after such switches, where `.resume()` silently no-ops. After an OS audio
// device route change (Bluetooth, AirPlay, sleep/wake), `state` can report
// `running` while no sound is produced ("silent running" bug).
//
// Strategy:
//   1. Mark the context "stale" on ANY focus/blur/visibility transition.
//   2. Non-gesture callers (socket events) that hit a stale-or-not-running
//      context return NULL and skip playback entirely — playing into such a
//      context queues tones that may fire as random beeps when the context
//      finally resumes, AND the tones aren't actually audible during the
//      broken window anyway.
//   3. On the next user gesture (pointerdown, capture phase), close and
//      recreate the context — this is the only universal recovery path
//      across Safari's `interrupted` state, Chrome's `suspended` state,
//      and all OS audio route-change edge cases.

let _audioCtx    = null
let _masterGain  = null
let _synthVolume = 0.15
let _maybeStale  = false

function attachStateChangeWatcher(ac) {
  // Safari transitions to `interrupted` without firing focus/blur events
  // during some audio route changes. Mark stale so the next gesture recreates.
  // IMPORTANT: ignore events from contexts we've already replaced — when
  // createFreshCtx() closes the previous context, its `statechange` fires
  // asynchronously with `state === 'closed'` and would otherwise set
  // _maybeStale=true right after we just cleared it, trapping the next play()
  // in the stale-bail path forever.
  ac.addEventListener?.('statechange', () => {
    if (ac !== _audioCtx) return
    if (ac.state !== 'running') _maybeStale = true
  })
}

function createFreshCtx() {
  try { _audioCtx?.close() } catch (_) {}
  _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  _masterGain = _audioCtx.createGain()
  _masterGain.gain.value = _synthVolume
  _masterGain.connect(_audioCtx.destination)
  attachStateChangeWatcher(_audioCtx)
  _maybeStale = false
  return _audioCtx
}

// iOS Safari unlock: a fresh AudioContext can start in 'suspended' state even
// when created inside a user gesture, and resume() called later (from a
// socket-driven play()) silently no-ops. The reliable unlock is to call
// resume() synchronously inside the gesture AND immediately schedule a
// zero-duration silent buffer. Once unlocked, the context stays running until
// the next app-switch / lock.
function unlockIOSAudio(ac) {
  if (!ac) return
  try { ac.resume() } catch (_) {}
  try {
    const buffer = ac.createBuffer(1, 1, 22050)
    const source = ac.createBufferSource()
    source.buffer = buffer
    source.connect(ac.destination)
    source.start(0)
  } catch (_) {}
}

// Touch-primary devices (iPhone, iPad, Android) have no multi-window
// concept, and `document.hasFocus()` on iOS Safari often returns false even
// when the page is active — silencing all playback. Fall back to
// `visibilityState` there, which fires reliably on app-switch / lock.
const _isTouchDevice = typeof window !== 'undefined'
  && (('ontouchstart' in window) || (navigator?.maxTouchPoints ?? 0) > 0)

// Return the context ONLY if it's safe to schedule tones on it right now.
// Return null for non-gesture callers when the context is stale, missing, or
// not `running`. Null callers bail silently — no queued beeps. The next user
// gesture recreates the context and playback resumes automatically.
function ctx() {
  // Guard against playing while on another macOS Space / another app.
  // `blur` does NOT fire reliably on Space switches (the window stays the
  // frontmost in its Space per AppKit), so `_maybeStale` may still be false
  // even when the user can't hear anything. On desktop, `document.hasFocus()`
  // is the authoritative "am I the active window right now" check. On touch
  // devices there's no Space / secondary-window concept, and iOS Safari
  // frequently reports `hasFocus() === false` even when the page is active,
  // so use visibilityState there instead.
  if (typeof document !== 'undefined') {
    if (_isTouchDevice) {
      if (document.visibilityState === 'hidden') { _lastPlay.result = 'hidden'; return null }
    } else if (!document.hasFocus()) {
      _lastPlay.result = 'no-focus'; return null
    }
  }
  if (_maybeStale) { _lastPlay.result = 'stale'; return null }
  if (!_audioCtx || _audioCtx.state === 'closed') { _lastPlay.result = 'no-ctx'; return null }
  if (_audioCtx.state === 'suspended') {
    // resume() is async. On iOS Safari the context often spends a brief
    // moment in 'suspended' right after createFreshCtx + silent-buffer unlock,
    // and an in-flight play() call would race ahead. Kick resume and return
    // the context anyway — oscillator schedule calls queue onto a suspended
    // context and fire when it transitions to running, so the sound still
    // plays (just a few ms late). For 'interrupted' (Safari route-change),
    // resume() silently no-ops, so we still bail.
    _audioCtx.resume().catch(() => {})
    _lastPlay.result = 'suspended:scheduled'
    return _audioCtx
  }
  if (_audioCtx.state !== 'running') {
    _lastPlay.result = `not-running:${_audioCtx.state}`
    return null
  }
  _lastPlay.result = 'ok'
  return _audioCtx
}

if (typeof window !== 'undefined') {
  // Capture-phase pointerdown fires BEFORE any component handlers, so we can
  // prepare the audio pipeline before the click sound needs to play. Inside
  // a user gesture, a fresh AudioContext starts 'running' on every browser —
  // this bypasses `.resume()` entirely and is the only reliable recovery
  // path from Safari's `interrupted` state or the silent-running bug.
  document.addEventListener('pointerdown', () => {
    if (!_audioCtx || _audioCtx.state !== 'running' || _maybeStale) {
      createFreshCtx()
    }
    // Synchronously inside the gesture: kick resume() and schedule a silent
    // buffer. No-op on desktop (context is already running); critical on iOS
    // Safari where a fresh context is often 'suspended' and later resume()
    // calls from outside a gesture don't do anything.
    unlockIOSAudio(_audioCtx)
  }, { capture: true, passive: true })

  // On departure, close the AudioContext — not just mark stale. Tones are
  // scheduled `LOOKAHEAD` seconds into the future (~50ms); without close(),
  // those already-queued `osc.start(t)` calls fire while the user is on the
  // other Space / tab, producing "spontaneous beeps". close() cancels them.
  // Marking stale also blocks future schedules from socket-driven events.
  // pointerdown (capture) recreates the context on return.
  function suspendAndClose() {
    _maybeStale = true
    try { _audioCtx?.close() } catch (_) {}
    _audioCtx   = null
    _masterGain = null
  }

  // `window.focus`/`blur` are the ONLY reliable macOS Space-switch signals.
  window.addEventListener('blur',  suspendAndClose)
  // focus just marks stale — actual recreation happens on the next gesture.
  window.addEventListener('focus', () => { _maybeStale = true })

  // visibilitychange covers tab-switch / minimize / occlusion. Only close on
  // transition TO hidden; the visible transition is handled by pointerdown.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') suspendAndClose()
  })

  // `pagehide` fires on bfcache eviction and tab close — close to release.
  window.addEventListener('pagehide', suspendAndClose)
}

// ── Debug telemetry (audio debug overlay reads these) ────────────────────────
// `_lastPlay` records the result of the last ctx() call so the overlay can
// show WHY a sound didn't play (`no-focus`, `stale`, `no-ctx`, `suspended`,
// or `ok`). Cheap (single object write) so we leave it on in all builds.
let _lastPlay = { key: null, at: 0, result: 'none' }

export function _getAudioDebugState() {
  return {
    hasCtx:       !!_audioCtx,
    state:        _audioCtx?.state ?? 'none',
    maybeStale:   _maybeStale,
    masterGain:   _masterGain?.gain?.value ?? null,
    synthVolume:  _synthVolume,
    isTouchDevice: _isTouchDevice,
    hasFocus:     typeof document !== 'undefined' && typeof document.hasFocus === 'function'
      ? document.hasFocus()
      : null,
    visibilityState: typeof document !== 'undefined' ? document.visibilityState : null,
    lastPlay:     { ..._lastPlay },
  }
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
    move()    { const ac = ctx(); if (!ac) return; const t = ac.currentTime + LOOKAHEAD; tone(ac, 'square', 330, t, 0.08, 0.15); tone(ac, 'square', 440, t + 0.05, 0.07, 0.12) },
    win()     { const ac = ctx(); if (!ac) return; const t = ac.currentTime + LOOKAHEAD; [523, 659, 784, 1047].forEach((f, i) => tone(ac, 'square', f, t + i * 0.1, 0.15, 0.15)) },
    draw()    { const ac = ctx(); if (!ac) return; const t = ac.currentTime + LOOKAHEAD; tone(ac, 'square', 440, t, 0.1, 0.15); tone(ac, 'square', 330, t + 0.12, 0.1, 0.12) },
    forfeit() { const ac = ctx(); if (!ac) return; const t = ac.currentTime + LOOKAHEAD; tone(ac, 'square', 330, t, 0.12, 0.15); tone(ac, 'square', 220, t + 0.14, 0.18, 0.15); tone(ac, 'square', 165, t + 0.30, 0.22, 0.12) },
  },
  nature: {
    move()    { const ac = ctx(); if (!ac) return; const t = ac.currentTime + LOOKAHEAD; tone(ac, 'sine', 528, t, 0.18, 0.12); tone(ac, 'sine', 792, t + 0.02, 0.12, 0.08) },
    win()     { const ac = ctx(); if (!ac) return; const t = ac.currentTime + LOOKAHEAD; [528, 660, 792, 1056].forEach((f, i) => { tone(ac, 'sine', f, t + i * 0.14, 0.28, 0.14); tone(ac, 'sine', f * 1.5, t + i * 0.14, 0.20, 0.06) }) },
    draw()    { const ac = ctx(); if (!ac) return; const t = ac.currentTime + LOOKAHEAD; tone(ac, 'sine', 440, t, 0.25, 0.10); tone(ac, 'sine', 528, t + 0.05, 0.20, 0.08) },
    forfeit() {
      const ac = ctx(); if (!ac) return
      const t = ac.currentTime + LOOKAHEAD
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
        _lastPlay.key = key
        _lastPlay.at  = Date.now()
        const { muted, soundPack } = get()
        if (muted) { _lastPlay.result = 'muted'; return }
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
