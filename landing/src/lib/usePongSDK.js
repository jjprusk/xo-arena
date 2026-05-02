// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * usePongSDK — platform SDK provider for the Pong spike (SSE+POST).
 *
 * Implements the same { session, sdk } interface shape as useGameSDK but
 * wired to Pong-specific channels:
 *   POST /rt/pong/rooms        — create
 *   POST /rt/pong/rooms/:slug/join  — join
 *   POST /rt/pong/rooms/:slug/input — paddle direction
 *   pong:<slug>:state         — server broadcasts at ~30fps
 *   pong:<slug>:lifecycle     — started / abandoned
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { rtFetch, getSseSession, onSseSessionChange } from './rtSession.js'
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
  // SSE branch: capture the sessionId that did the join and pin it to all
  // subsequent input POSTs. Without this, a later useEventStream mount
  // overwrites the module-level cache, and inputs land on a session that
  // isn't seated in the room (server: `room.players.indexOf(sid) === -1`).
  const pongSessionIdRef = useRef(null)

  // ── SDK object ─────────────────────────────────────────────────────────────
  const sdk = useMemo(() => ({
    // Send paddle direction to server. The POST returns immediately; the
    // next ~33 ms tick on the `pong:<slug>:state` channel reflects the change.
    submitMove({ direction }) {
      const slug = slugRef.current
      if (!slug) return
      rtFetch(`/rt/pong/rooms/${slug}/input`, {
        body:      { direction },
        sessionId: pongSessionIdRef.current,
      }).catch((err) => {
        console.warn('[usePongSDK] input POST failed', err?.status, err?.code, err?.message)
      })
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

  // ── SSE+POST lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
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
    let unsubSession = null

    // Cold-load race: PongPage mounts at the same time as AppLayout's guide
    // EventSource. The join POST has to attach X-SSE-Session, but that id
    // only becomes available once the EventSource has parsed its first
    // `event: session` frame. Wait until the holder is non-null before
    // posting, otherwise the server returns 409 SSE_SESSION_MISSING.
    function waitForSession() {
      if (getSseSession()) return Promise.resolve()
      return new Promise((resolve) => {
        unsubSession = onSseSessionChange((id) => { if (id) resolve() })
      })
    }

    ;(async () => {
      try {
        await waitForSession()
        if (cancelled) return

        // Pin the current sessionId for the lifetime of this game. Snapshot
        // here, BEFORE the rtFetch — that way any later useEventStream mount
        // that overwrites the global cache doesn't affect input POSTs.
        const pinnedSid = getSseSession()
        pongSessionIdRef.current = pinnedSid

        if (joinSlug) {
          const res = await rtFetch(`/rt/pong/rooms/${joinSlug}/join`, { sessionId: pinnedSid })
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
          const res = await rtFetch('/rt/pong/rooms', { body: { slug }, sessionId: pinnedSid })
          if (cancelled) return
          playerIndexRef.current = res.playerIndex
          setRoomSlug(slug)
          setPhase('waiting')
          buildSession({ playerIndex: res.playerIndex })
        }
      } catch (err) {
        // Surface the failure rather than silently sticking on "Connecting…".
        console.warn('[usePongSDK] SSE+POST join failed:', err?.status, err?.code, err?.message)
        setAbandoned({ reason: err?.code === 'SSE_SESSION_MISSING' ? 'session-missing' : 'join-failed' })
        setPhase('finished')
      }
    })()

    return () => { cancelled = true; unsubSession?.() }
  }, [joinSlug])

  // SSE channel subscription — fires only when we know the slug.
  useEventStream({
    enabled: !!roomSlug,
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
