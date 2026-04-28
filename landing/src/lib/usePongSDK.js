// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * usePongSDK — platform SDK provider for the Pong spike.
 *
 * Implements the same { session, sdk } interface shape as useGameSDK but
 * wired to Pong-specific socket events:
 *   pong:create / pong:join  — room lifecycle
 *   pong:input               — player sends paddle direction
 *   pong:state               — server broadcasts game state at ~30fps
 *   pong:started / pong:abandoned — game lifecycle
 *
 * Spike component — removable with the rest of the Pong package.
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { connectSocket, getSocket } from './socket.js'
import { viaSse } from './realtimeMode.js'
import { rtFetch } from './rtSession.js'
import { useEventStream } from './useEventStream.js'

/**
 * @param {{ slug: string|null, currentUser: object|null }} options
 *   slug = null → create a new room (P1)
 *   slug = 'mt-foo' → join existing room (P2 or spectator)
 */
export function usePongSDK({ slug: joinSlug = null, currentUser = null }) {
  const [phase, setPhase]         = useState('connecting')  // connecting|waiting|playing|finished
  const [session, setSession]     = useState(null)
  const [abandoned, setAbandoned] = useState(null)
  const [roomSlug, setRoomSlug]   = useState(null)

  const currentUserRef  = useRef(currentUser)
  currentUserRef.current = currentUser

  const playerIndexRef  = useRef(null)
  const moveHandlersRef = useRef([])
  const gameEndCbRef    = useRef(null)
  const slugRef         = useRef(joinSlug)

  // ── SDK object ─────────────────────────────────────────────────────────────
  const sdk = useMemo(() => ({
    // Send paddle direction to server. On the SSE+POST transport, this fires
    // an async POST to /rt/pong/rooms/:slug/input — the next ~33 ms tick on
    // the `pong:<slug>:state` channel reflects the change. On the legacy
    // socket transport, the emit is synchronous.
    submitMove({ direction }) {
      const slug = slugRef.current
      if (!slug) return
      if (viaSse('pong')) {
        rtFetch(`/rt/pong/rooms/${slug}/input`, { body: { direction } }).catch(() => {})
        return
      }
      getSocket().emit('pong:input', { slug, direction })
    },

    // Register handler for pong:state ticks  → { state, sentAt }
    onMove(handler) {
      moveHandlersRef.current.push(handler)
      return () => {
        moveHandlersRef.current = moveHandlersRef.current.filter(h => h !== handler)
      }
    },

    signalEnd(result) {
      gameEndCbRef.current?.(result)
    },

    getPlayers()   { return [] },
    getSettings()  { return {} },
    spectate(h)    { return sdk.onMove(h) },

    _onGameEnd(cb) { gameEndCbRef.current = cb },
  }), [])

  // ── Socket lifecycle (legacy transport) ────────────────────────────────────
  useEffect(() => {
    if (viaSse('pong')) return  // Phase 6 — SSE+POST branch handles wiring
    const socket = connectSocket()

    function buildSession(overrides = {}) {
      const s = {
        tableId:      slugRef.current ?? '',
        gameId:       'pong',
        players:      [],
        currentUserId: currentUserRef.current?.id ?? null,
        isSpectator:  overrides.isSpectator ?? false,
        playerIndex:  overrides.playerIndex ?? playerIndexRef.current,
        settings:     {},
      }
      setSession(s)
      return s
    }

    // ── Room events ────────────────────────────────────────────────────────

    socket.on('pong:created', ({ slug, playerIndex }) => {
      slugRef.current      = slug
      playerIndexRef.current = playerIndex
      setRoomSlug(slug)
      setPhase('waiting')
      buildSession({ playerIndex })
    })

    socket.on('pong:joined', ({ slug, playerIndex, spectating, state }) => {
      slugRef.current      = slug
      playerIndexRef.current = playerIndex
      setRoomSlug(slug)
      const isSpec = spectating || playerIndex === null
      setPhase(isSpec || state?.status === 'playing' ? 'playing' : 'waiting')
      buildSession({ playerIndex, isSpectator: isSpec })
      // If joining mid-game, feed current state immediately
      if (state) {
        moveHandlersRef.current.forEach(h => h({ state, sentAt: null }))
      }
    })

    socket.on('pong:started', ({ state }) => {
      setPhase('playing')
      buildSession()
      moveHandlersRef.current.forEach(h => h({ state, sentAt: null }))
    })

    // ── State ticks ────────────────────────────────────────────────────────

    socket.on('pong:state', ({ state, sentAt }) => {
      moveHandlersRef.current.forEach(h => h({ state, sentAt }))
      if (state.status === 'finished') setPhase('finished')
    })

    // ── Abandon ────────────────────────────────────────────────────────────

    socket.on('pong:abandoned', ({ reason }) => {
      setAbandoned({ reason })
      setPhase('finished')
    })

    // ── Connect / initial action ───────────────────────────────────────────

    let emitted = false
    function emitAction() {
      if (emitted) return
      emitted = true
      if (joinSlug) {
        socket.emit('pong:join', { slug: joinSlug })
      } else {
        // Generate a slug from the current timestamp for the spike
        const slug = `pong-${Math.random().toString(36).slice(2, 8)}`
        slugRef.current = slug
        socket.emit('pong:create', { slug })
      }
    }

    if (socket.connected) emitAction()
    else socket.once('connect', emitAction)

    return () => {
      emitted = true
      socket.off('connect', emitAction)
      ;['pong:created', 'pong:joined', 'pong:started', 'pong:state', 'pong:abandoned']
        .forEach(ev => socket.off(ev))
    }
  }, [joinSlug])

  // ── SSE+POST lifecycle (Phase 6) ──────────────────────────────────────────
  // Mirrors the socket effect above but uses rtFetch + useEventStream. The
  // server runs the same `pongRunner.joinRoom()` either way — the only
  // differences are how the create/join is invoked (POST vs socket.emit) and
  // how the resulting state ticks reach the client (SSE channel vs socket.io
  // room).
  useEffect(() => {
    if (!viaSse('pong')) return

    function buildSession(overrides = {}) {
      const s = {
        tableId:       slugRef.current ?? '',
        gameId:        'pong',
        players:       [],
        currentUserId: currentUserRef.current?.id ?? null,
        isSpectator:   overrides.isSpectator ?? false,
        playerIndex:   overrides.playerIndex ?? playerIndexRef.current,
        settings:      {},
      }
      setSession(s)
      return s
    }

    let cancelled = false
    ;(async () => {
      try {
        if (joinSlug) {
          const res = await rtFetch(`/rt/pong/rooms/${joinSlug}/join`)
          if (cancelled) return
          slugRef.current        = res.slug
          playerIndexRef.current = res.playerIndex
          setRoomSlug(res.slug)
          const isSpec = res.spectating || res.playerIndex === null
          setPhase(isSpec || res.state?.status === 'playing' ? 'playing' : 'waiting')
          buildSession({ playerIndex: res.playerIndex, isSpectator: isSpec })
          if (res.state) {
            moveHandlersRef.current.forEach(h => h({ state: res.state, sentAt: null }))
          }
        } else {
          const slug = `pong-${Math.random().toString(36).slice(2, 8)}`
          slugRef.current = slug
          const res = await rtFetch('/rt/pong/rooms', { body: { slug } })
          if (cancelled) return
          playerIndexRef.current = res.playerIndex
          setRoomSlug(slug)
          setPhase('waiting')
          buildSession({ playerIndex: res.playerIndex })
        }
      } catch {
        // Connection issues surface via the EventSource auto-reconnect; the
        // user-visible state stays in `connecting` until the join succeeds.
      }
    })()

    return () => { cancelled = true }
  }, [joinSlug])

  // SSE channel subscription — fires only when we know the slug. The server
  // dual-emits to `pong:<slug>:state` (per-tick) and `pong:<slug>:lifecycle`
  // (started/abandoned).
  useEventStream({
    enabled: viaSse('pong') && !!roomSlug,
    channels: roomSlug ? [`pong:${roomSlug}:state`, `pong:${roomSlug}:lifecycle`] : [],
    eventTypes: roomSlug ? [`pong:${roomSlug}:state`, `pong:${roomSlug}:lifecycle`] : [],
    onEvent: (channel, data) => {
      if (channel === `pong:${roomSlug}:state`) {
        const { state, sentAt } = data ?? {}
        if (!state) return
        moveHandlersRef.current.forEach(h => h({ state, sentAt: sentAt ?? null }))
        if (state.status === 'finished') setPhase('finished')
        return
      }
      if (channel === `pong:${roomSlug}:lifecycle`) {
        if (data?.kind === 'started') {
          setPhase('playing')
          if (data.state) {
            moveHandlersRef.current.forEach(h => h({ state: data.state, sentAt: null }))
          }
          return
        }
        if (data?.kind === 'abandoned') {
          setAbandoned({ reason: data.reason ?? 'disconnect' })
          setPhase('finished')
        }
      }
    },
  })

  return { session, sdk, phase, abandoned, roomSlug }
}
