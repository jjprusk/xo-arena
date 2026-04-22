// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * AudioDebugOverlay — floating on-screen telemetry for iOS Safari audio.
 *
 * Activation: append `?audioDebug=1` to any URL. The flag persists in
 * sessionStorage so it survives in-app navigation (React Router rewrites the
 * URL without the query string). To clear, close the tab or use `?audioDebug=0`.
 *
 * Shows the live state of both AudioContexts (game sounds + notif sounds), the
 * iOS unlock flags, and the last play() attempt's key + resolution. Exposes
 * a "Test" button that calls play('move') directly — confirms whether the
 * sound pipeline works in isolation from socket timing.
 *
 * This is a debug tool, not a production feature: we do NOT bundle it into the
 * default tree. AppLayout mounts it only when the flag is set.
 */
import React, { useEffect, useState } from 'react'
import { useSoundStore, _getAudioDebugState } from '../../store/soundStore.js'
import { useNotifSoundStore, _getNotifAudioDebugState } from '../../store/notifSoundStore.js'

export default function AudioDebugOverlay() {
  const [tick, setTick]     = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const soundMuted = useSoundStore(s => s.muted)
  const soundVol   = useSoundStore(s => s.volume)
  const soundPack  = useSoundStore(s => s.soundPack)
  const notifOn    = useNotifSoundStore(s => s.enabled)
  const notifType  = useNotifSoundStore(s => s.type)

  // Re-render every 250ms so state transitions are visible live.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 250)
    return () => clearInterval(id)
  }, [])

  const game  = _getAudioDebugState()
  const notif = _getNotifAudioDebugState()

  function testGameSound() { useSoundStore.getState().play('move') }
  function testNotifSound() { useNotifSoundStore.getState().play() }

  const line = { display: 'flex', gap: 8, justifyContent: 'space-between', fontSize: 11, lineHeight: 1.35 }
  const label = { color: '#888' }
  const val   = { color: '#fff', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }

  const agoMs = (t) => t ? `${Math.round((Date.now() - t) / 100) / 10}s ago` : '—'
  const stateColor = (s) => s === 'running' ? '#7ee787' : s === 'suspended' ? '#f0b84c' : s === 'closed' ? '#ff7b72' : '#aaa'

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        style={{
          position: 'fixed', bottom: 8, left: 8, zIndex: 99999,
          padding: '4px 8px', fontSize: 11,
          background: '#111', color: '#fff',
          border: '1px solid #444', borderRadius: 4,
        }}
      >
        🔊 {game.state} / {notif.state}
      </button>
    )
  }

  return (
    <div
      style={{
        position: 'fixed', bottom: 8, left: 8, zIndex: 99999,
        width: 260, padding: 10,
        background: 'rgba(17, 17, 17, 0.95)', color: '#fff',
        border: '1px solid #444', borderRadius: 6,
        fontSize: 11, lineHeight: 1.4,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontWeight: 600 }}>
        <span>Audio debug</span>
        <button onClick={() => setCollapsed(true)} style={{ background: 'none', color: '#888', border: 'none', fontSize: 14 }}>×</button>
      </div>

      <div style={{ borderTop: '1px solid #333', paddingTop: 6, marginBottom: 6 }}>
        <div style={{ color: '#7ee787', fontSize: 10, marginBottom: 4 }}>GAME SOUND</div>
        <div style={line}><span style={label}>state</span><span style={{ ...val, color: stateColor(game.state) }}>{game.state}</span></div>
        <div style={line}><span style={label}>maybeStale</span><span style={val}>{String(game.maybeStale)}</span></div>
        <div style={line}><span style={label}>masterGain</span><span style={val}>{game.masterGain?.toFixed?.(2) ?? '—'}</span></div>
        <div style={line}><span style={label}>muted</span><span style={val}>{String(soundMuted)}</span></div>
        <div style={line}><span style={label}>volume</span><span style={val}>{soundVol}</span></div>
        <div style={line}><span style={label}>pack</span><span style={val}>{soundPack}</span></div>
        <div style={line}><span style={label}>last</span><span style={val}>{game.lastPlay.key || '—'} · {game.lastPlay.result} · {agoMs(game.lastPlay.at)}</span></div>
      </div>

      <div style={{ borderTop: '1px solid #333', paddingTop: 6, marginBottom: 6 }}>
        <div style={{ color: '#f0b84c', fontSize: 10, marginBottom: 4 }}>NOTIF SOUND</div>
        <div style={line}><span style={label}>state</span><span style={{ ...val, color: stateColor(notif.state) }}>{notif.state}</span></div>
        <div style={line}><span style={label}>gesture</span><span style={val}>{String(notif.gestureHappened)}</span></div>
        <div style={line}><span style={label}>enabled</span><span style={val}>{String(notifOn)}</span></div>
        <div style={line}><span style={label}>type</span><span style={val}>{notifType}</span></div>
        <div style={line}><span style={label}>last</span><span style={val}>{notif.lastPlay.type || '—'} · {notif.lastPlay.result} · {agoMs(notif.lastPlay.at)}</span></div>
      </div>

      <div style={{ borderTop: '1px solid #333', paddingTop: 6, marginBottom: 6 }}>
        <div style={{ color: '#a0c4ff', fontSize: 10, marginBottom: 4 }}>ENV</div>
        <div style={line}><span style={label}>touchDevice</span><span style={val}>{String(game.isTouchDevice)}</span></div>
        <div style={line}><span style={label}>hasFocus</span><span style={val}>{String(game.hasFocus)}</span></div>
        <div style={line}><span style={label}>visibility</span><span style={val}>{game.visibilityState}</span></div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button
          onClick={testGameSound}
          style={{ flex: 1, padding: '6px 8px', fontSize: 11, background: '#1f6feb', color: '#fff', border: 'none', borderRadius: 4 }}
        >
          Test move
        </button>
        <button
          onClick={testNotifSound}
          style={{ flex: 1, padding: '6px 8px', fontSize: 11, background: '#8957e5', color: '#fff', border: 'none', borderRadius: 4 }}
        >
          Test notif
        </button>
      </div>
    </div>
  )
}
