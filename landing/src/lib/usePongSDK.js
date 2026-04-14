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
    // Send paddle direction to server
    submitMove({ direction }) {
      getSocket().emit('pong:input', { slug: slugRef.current, direction })
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

  // ── Socket lifecycle ───────────────────────────────────────────────────────
  useEffect(() => {
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

  return { session, sdk, phase, abandoned, roomSlug }
}
