# Game System Audit Report
**Date**: 2026-04-15  
**Scope**: XO game integration — SDK design, game implementation, platform integration  
**Status**: All four fixes applied — see "Resolution" section

---

## Executive Summary

Three root causes explain every reported symptom (laggy load, JS errors, sounds stopping):

1. **Double sound system** — every move plays two sounds simultaneously from two separate, uncoordinated `AudioContext` instances
2. **Game `AudioContext` has no visibility handler** — when the tab is backgrounded and restored, the game's audio context never resumes, silencing all game-side sounds
3. **Session object identity thrashing** — `buildSession()` creates a new object reference on every socket event (6+ call sites), causing unnecessary `GameComponent` re-renders on every state update

Issues 1 and 2 share a common architectural root: the game and the platform both own an `AudioContext` and neither knows about the other.

---

## Layer 1: SDK Design

**Files**: `packages/sdk/src/`

The SDK contract is clean and minimal. No structural issues.

- `GameContract` defines the required interface: `submitMove`, `onMove`, `signalEnd`, `spectate`, `getPlayers`, `getSettings`, `getPreviewState`, `getPlayerState`
- The `sdk` object is stable — created with `useMemo([], [])` in `useGameSDK.js`, never re-created
- **No sound API is defined in the contract.** This is the design gap that leads to the dual-AudioContext problem. The SDK intentionally leaves sound to each game, but the platform *also* handles sound independently, creating two competing systems with no coordination mechanism.

**Verdict**: SDK design is sound for its scope. The gap is the absence of a sound delegation API — games currently must either implement their own audio or rely on undocumented platform behavior.

---

## Layer 2: Game Implementation

**Files**: `packages/game-xo/src/`

### `GameComponent.jsx`

- Follows the `GameContract` correctly
- `sdk` and `session` props are used as intended
- Listener cleanup is correct (`sdk.onMove` / `sdk.spectate` return unsubscribe functions; cleanup runs on unmount)
- `useEffect` dependency on `session?.isSpectator` is correct — the effect only re-runs when spectator status actually changes, not on every session re-render

### `soundUtils.js` — Critical Issue

```js
// packages/game-xo/src/soundUtils.js

let _ctx = null

function ctx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)()
  if (_ctx.state === 'suspended') _ctx.resume().catch(() => {})
  return _ctx
}
```

**Problem 1: Separate AudioContext**  
This creates a module-scoped `AudioContext` (`_ctx`) that is entirely independent from the platform's context (`_audioCtx` in `soundStore.js`). There is no master gain, no volume control, and no mute toggle affecting this context.

**Problem 2: No visibility handler**  
`soundStore.js` correctly handles tab visibility to resume its context:
```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (_audioCtx?.state === 'suspended') _audioCtx.resume().catch(() => {})
  }
})
```
`soundUtils.js` has no equivalent. When the browser suspends audio contexts on tab background, the game context is never resumed. All subsequent game sounds are silently dropped.

**Problem 3: No try/catch on context creation**  
`soundStore.js` wraps sound synthesis in try/catch. `soundUtils.js` does not. If `AudioContext` creation fails (headless environments, locked-down browsers), the module throws an uncaught error.

### Where `playSound()` is called in `GameComponent.jsx`

| Call site | Event |
|---|---|
| `handleMoveEvent` line 115 | opponent move / game end |
| `handleForfeit` line 148 | player forfeits |
| `handleRematch` line 154 | player requests rematch |

---

## Layer 3: Platform Integration

**Files**: `landing/src/lib/useGameSDK.js`, `landing/src/pages/PlayPage.jsx`, `landing/src/lib/socket.js`, `landing/src/store/soundStore.js`

### Double Sound — Root Cause

The platform (`useGameSDK.js`) plays sounds directly from socket event handlers:

```js
// useGameSDK.js — socket events → platform sound
socket.on('game:moved', ({ ..., status, winner }) => {
  if (status === 'finished') {
    useSoundStore.getState().play(winner ? 'win' : 'draw')  // platform AudioContext
  } else if (!localMovePendingRef.current) {
    useSoundStore.getState().play('move')                    // platform AudioContext
  }
  emitMoveEvent(...)  // → triggers handleMoveEvent in GameComponent
})
```

`emitMoveEvent` calls the handlers registered via `sdk.onMove`, which calls `handleMoveEvent` in `GameComponent.jsx`, which calls `playSound()` — **the game's own AudioContext**.

**Result**: every move plays two sounds — one from `soundStore._audioCtx`, one from `soundUtils._ctx`. They use the same frequencies and timing, producing a chorus/doubling effect. When one context is suspended (e.g., after a tab switch), the other may still play, producing inconsistent audio depending on which context is in what state.

**Own-move path**:
1. `sdk.submitMove()` → `useSoundStore.play('move')` (platform)
2. `game:moved` arrives → platform checks `localMovePendingRef = true` → **skips** platform sound ✓
3. `emitMoveEvent` → `handleMoveEvent` → `playSound('move')` (game) ← still plays

**Opponent-move path**:
1. `game:moved` arrives → platform plays 'move' (platform)
2. `emitMoveEvent` → `handleMoveEvent` → `playSound('move')` (game) ← also plays

**Every sound plays twice.**

### `buildSession` Identity Thrashing

`buildSession()` is called on every socket event with `setSession({ ...s })` — a spread that always produces a new object:

```js
// useGameSDK.js
function buildSession(overrides = {}) {
  const s = { tableId, gameId, players, currentUserId, isSpectator, settings }
  setSession({ ...s })  // new object reference every time
  return s
}
```

Call sites (every socket event):
- `room:created` → line 191
- `room:created:hvb` → line 208
- `room:renamed` → line 223
- `room:joined` → line 255
- `room:guestJoined` → line 284
- `game:start` → line 318

Since `session` is passed as a prop to `GameComponent`, React re-renders the game component on every socket event — even when nothing visible has changed. For a game that receives socket events every few seconds, this is constant churn.

In practice this doesn't break anything (no state resets, no effect re-runs since `session?.isSpectator` doesn't change mid-game), but it causes unnecessary work and makes profiling difficult.

### `soundStore.js` — What Works Correctly

```js
// soundStore.js
document.addEventListener('pointerdown', () => {
  if (_audioCtx?.state === 'suspended') _audioCtx.resume().catch(() => {})
}, { capture: true, passive: true })

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (_audioCtx?.state === 'suspended') _audioCtx.resume().catch(() => {})
  }
})
```

The platform sound system handles context suspension correctly. Sounds from the platform resume properly after tab switches. It's only the game's separate context that doesn't resume.

### Socket Errors (Dev-Only)

The `400 Bad Request` errors on `/socket.io` polling requests and the Safari "access control checks" error are **dev-environment artifacts**, not production bugs.

**Cause**: The visibility handler in `socket.js` calls `_socket.disconnect()` when the tab hides. This closes the server-side socket session. Any in-flight polling GET from the client (waiting for the next push) receives 400 because the session no longer exists on the server.

**Fix applied**: Modified `socket.js` to only disconnect on tab hide in Safari (where the browser forcibly kills in-flight XHRs, causing the "access control" error). In Chrome/Firefox, the socket now survives tab switches without a 400.

In production, WebSocket transport is used and this entire class of issue doesn't apply.

---

## Cross-Layer Issues

### Sound Architecture Summary

| Layer | File | AudioContext | Resume handler |
|---|---|---|---|
| Platform | `soundStore.js` | `_audioCtx` — shared, with master gain | yes (`visibilitychange` + `pointerdown`) |
| Game | `soundUtils.js` | `_ctx` — isolated, no gain node | none |

Neither system knows about the other. The platform volume/mute controls have no effect on game sounds. Game sounds go silent after tab switches. Every event plays both.

### Stale Closure on `signalEnd`

`handleMoveEvent` in `GameComponent.jsx` is defined without `useCallback` and closes over `session`. The `useEffect` that registers it via `sdk.onMove` has `[sdk, session?.isSpectator]` as deps — meaning the registered function is replaced when `session?.isSpectator` changes (null→false on first room event), but NOT afterward.

In practice this is safe because marks and players are set before the game starts and don't change mid-game. But if session were ever updated in a way that changed player IDs or marks during a game, `signalEnd` would receive stale data.

---

## Root Cause Analysis

### Root Cause 1: Dual AudioContext (Symptoms: double sounds, sounds stopping)

The game (`soundUtils.js`) and platform (`soundStore.js`) each create an independent `AudioContext`. They produce the same sounds for the same events, neither is aware of the other, and only the platform context is managed through the app lifecycle.

**Direct consequences**:
- Double sounds on every move
- Game sounds stop working after tab switch
- Platform mute/volume settings don't affect game sounds
- Up to two browser AudioContexts created per session (browsers typically limit to 6)

### Root Cause 2: Session Object Thrashing (Symptom: laggy UI, unnecessary renders)

`buildSession()` creates a new `session` object on every socket event and passes it to `GameComponent` as a prop. React sees a new object reference → re-renders. For a real-time game this is constant.

### Root Cause 3: No Socket Pre-Warm (Symptom: 1-2 second delay navigating to /play)

Without a pre-warmed socket connection, navigating to `/play` triggers the full socket.io polling handshake (several HTTP round trips through the Vite proxy), then the room creation round trip, before the game board appears. Re-adding the AppLayout pre-warm eliminates the handshake delay.

---

## What is NOT Broken

- SDK contract design — clean and minimal
- `sdk` object stability — correctly memoized, never re-created
- Socket listener cleanup — all handlers removed on unmount
- `emitted` guard — correctly prevents double room creation on reconnect
- `localMovePendingRef` — correctly prevents double platform sound on own moves
- Game component lifecycle — no infinite loops, no cascading renders

---

## Fixes Applied

All four fixes below have been implemented. See the **Resolution** section for per-file diffs and rationale.

| # | Fix | Symptoms addressed | Status |
|---|---|---|---|
| 1 | Extend SDK with `playSound`; remove game's `soundUtils.js` | Double sounds, audio stopping after tab switch, mute/volume not affecting game audio | **Done** |
| 2 | Stabilize session object identity | Unnecessary re-renders on every socket event | **Done** |
| 3 | Socket pre-warm in `AppLayout` | 1–2s navigation delay to `/play` | **Done** |
| 4 | Safari-only socket disconnect on tab hide | 400 console errors in dev; Safari "access control" error | **Done** |

---

## Files Referenced

| File | Role |
|---|---|
| `packages/sdk/src/index.d.ts` | GameContract / SDK interface definition |
| `packages/game-xo/src/GameComponent.jsx` | Game UI component |
| `packages/game-xo/src/soundUtils.js` | Game-side AudioContext (deleted in Resolution) |
| `landing/src/lib/useGameSDK.js` | Platform socket bridge / session management |
| `landing/src/pages/PlayPage.jsx` | Play page / GameView mount |
| `landing/src/lib/socket.js` | Socket.IO connection lifecycle |
| `landing/src/store/soundStore.js` | Platform AudioContext / sound synthesis |
| `backend/src/realtime/socketHandler.js` | Backend socket event handlers |

---

## Resolution (2026-04-15)

### Fix 1 — SDK sound API (dual AudioContext eliminated)

**Decision**: Rather than quietly deleting the game's duplicate sounds and leaving the platform to "automatically" play audio on socket events (implicit and fragile), the SDK was extended with a first-class `playSound(key)` method. The game is now the sound conductor; the platform is the sound provider. This eliminates the dual-AudioContext problem at the architectural level, not just in the current XO implementation.

**Changes**:

1. **`packages/sdk/src/index.d.ts`** — Added `playSound(key: string): void` to the `GameSDK` interface with JSDoc covering standard keys (`move`, `win`, `draw`, `forfeit`), mute/volume semantics, tab-suspension safety, and unknown-key behavior (no-op).

2. **`landing/src/lib/useGameSDK.js`** —
   - Added `playSound` method on the `sdk` object; delegates to `useSoundStore.getState().play(key)`
   - Removed the auto-play of sounds from the `game:moved` and `game:forfeit` socket handlers — platform no longer plays sounds on its own
   - Removed `localMovePendingRef` and associated logic (no longer needed; the game controls when sound plays)
   - Removed `useSoundStore.getState().play('move')` from `sdk.submitMove` — game's `handleCellClick` now plays it before calling submitMove, for instant feedback

3. **`packages/game-xo/src/GameComponent.jsx`** —
   - Removed `import { playSound } from './soundUtils.js'`
   - Replaced every `playSound(...)` call with `sdk.playSound?.(...)`
   - `handleCellClick` plays `'move'` before `submitMove` for instant local feedback
   - `handleMoveEvent` only plays `'move'` for *opponent* moves (`event.playerId !== session?.currentUserId`) — prevents the own-move double sound; end-of-game `'win'`/`'draw'` still play for both players

4. **`packages/game-xo/src/soundUtils.js`** — Deleted. Game no longer owns an AudioContext.

**Why this is the right architectural fix**:

- **Single source of truth** — one AudioContext, one master gain, one mute toggle, one lifecycle
- **Explicit, not implicit** — games must call `sdk.playSound(...)`; no magic auto-play means no mystery when sound is missing
- **Extensible** — future games can define custom keys (Poker: `'card-deal'`, `'chip-stack'`) and extend the platform synth without touching the contract
- **Mute/volume work everywhere** — user sound settings now govern all game audio
- **Tab suspension handled** — the one platform context has a visibility listener; game audio no longer silently dies after backgrounding

**Verification**:
- `sdk.playSound` defined on `GameSDK` interface with JSDoc
- Platform implementation routes to `soundStore`
- Platform stopped auto-playing sounds in socket handlers
- `localMovePendingRef` removed
- `GameComponent` imports removed for `soundUtils`
- All `playSound(...)` → `sdk.playSound?.(...)`
- Own-move double-sound prevented (game plays on click, skips on echo)
- `soundUtils.js` deleted; grep confirms no stale references

---

### Fix 2 — Session object stabilization

**`landing/src/lib/useGameSDK.js`** — `buildSession()` now uses a functional `setSession(prev => ...)` updater that preserves object identity when nothing meaningful has changed:

- Compares scalars directly (`tableId`, `gameId`, `isSpectator`, `currentUserId`)
- Compares `players` and `settings` via `JSON.stringify` — cheap at this scale, exact equality
- Returns the previous reference when content matches → no React re-render
- Returns the new object when anything changed → normal update path

**Effect**: `GameComponent` no longer re-renders on every socket event. Room renamings, spectator-count changes, and rapid server broadcasts that don't change player-visible state are now free. Future-proofs the pattern for Connect4 / Pong.

---

### Fix 3 — Socket pre-warm (AppLayout)

**`landing/src/components/layout/AppLayout.jsx`** — Re-added `connectSocket()` in a mount-effect for all users (signed-in or guest). Socket is established during initial app load, so by the time the user navigates to `/play` the handshake is already complete. Eliminates the 1–2s delay previously caused by starting the socket.io polling handshake on-demand through the Vite proxy.

---

### Fix 4 — Safari-only disconnect on tab hide

**`landing/src/lib/socket.js`** — Visibility handler now only calls `_socket.disconnect()` in Safari (where the browser forcibly aborts in-flight XHRs on background, producing the misleading "access control checks" error). Chrome and Firefox keep the socket alive across tab switches, which eliminates the 400 Bad Request errors caused by the server closing a session while a polling GET was still in flight.

Dev-only concern — in production, WebSocket transport avoids this class of issue entirely.

---

### Observations not yet addressed

These were noted in the audit but are not causing user-visible issues; left on the backlog:

- **Stale-closure on `signalEnd`** (Cross-Layer Issues section) — `handleMoveEvent` closes over `session` but is only re-registered when `session?.isSpectator` flips. Safe today because player IDs/marks don't change mid-game, but would need attention if a game ever mutates those during play.
- **Missing try/catch on AudioContext creation** — was only relevant to the deleted `soundUtils.js`; `soundStore.js` already wraps synthesis in try/catch.
