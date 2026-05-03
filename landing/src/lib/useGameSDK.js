// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { useState, useEffect, useRef, useMemo } from 'react'
import { getToken } from './getToken.js'
import { useSoundStore } from '../store/soundStore.js'
import { perfMark } from './perfLog.js'
import { rtFetch, getSseSession, onSseSessionChange } from './rtSession.js'
import { useEventStream } from './useEventStream.js'

/**
 * Subscribe to a single per-user idle channel via SSE. Internal helper for
 * useGameSDK — extracted so the hook signature stays simple and the
 * `eventTypes` array is a stable reference across renders.
 */
function useSseIdleWarning({ enabled, channel, onWarn }) {
  const channels   = useMemo(() => channel ? [channel.replace(/idle$/, '')] : [], [channel])
  const eventTypes = useMemo(() => channel ? [channel] : [], [channel])
  useEventStream({
    enabled,
    channels,
    eventTypes,
    onEvent: (chan, payload) => {
      if (chan !== channel) return
      if (payload?.kind === 'warning' && typeof payload.secondsRemaining === 'number') {
        onWarn(payload)
      }
    },
  })
}

/**
 * Platform-side SDK provider for SSE+POST games.
 *
 * Creates the GameSession and GameSDK objects and bridges them to the
 * /rt/* POST routes + the per-table SSE channels published by
 * tableFlowService. Games receive { session, sdk } as props and never
 * interact with auth, transport, or platform internals directly.
 *
 * @param {object} options
 * @param {string}  options.gameId         - e.g. 'xo'
 * @param {string|null} options.joinSlug   - room slug to join; null = create new room
 * @param {string|null} options.tournamentMatchId
 * @param {string|null} options.tournamentId
 * @param {object|null} options.currentUser - { id, displayName } from auth session
 *
 * @returns {{ session, sdk, phase, abandoned, kicked, seriesResult }}
 */
export function useGameSDK({
  gameId,
  joinSlug        = null,
  tournamentMatchId = null,
  tournamentId    = null,
  currentUser     = null,
  botUserId       = null,
  spectate        = false,
}) {
  // Phase 3.8.5.2 — picker payload is identity-scoped (botId only). The
  // server resolves (botId, gameId) → BotSkill at match start; any
  // legacy `botSkillId` prop is intentionally not accepted here.
  // ── State ──────────────────────────────────────────────────────────────────
  const [phase, setPhase_]          = useState('connecting')
  const phaseRef                    = useRef('connecting')
  const setPhase = (p) => { phaseRef.current = p; setPhase_(p) }
  const [session, setSession]       = useState(null)
  const [abandoned, setAbandoned]   = useState(null)
  const [kicked, setKicked]         = useState(false)
  const [seriesResult, setSeriesResult] = useState(null)
  const [opponentLeft, setOpponentLeft] = useState(false)
  // Once the initial create/join POST returns, we record the canonical Table.id
  // so useEventStream below can subscribe to `table:<id>:state|lifecycle|reaction`.
  const [tableId, setTableId] = useState(null)

  // currentUser in a ref so auth changes don't re-trigger the init effect.
  const currentUserRef = useRef(currentUser)
  currentUserRef.current = currentUser

  const boardRef    = useRef(Array(9).fill(null))
  const marksRef    = useRef({})
  const playersRef  = useRef([])
  const settingsRef = useRef({})
  const slugRef     = useRef(null)
  // Set to true when leaveTable() fires mid-game. The forfeit lifecycle event
  // surfacing from SSE flips this back and fires the gameEnd callback.
  const leavingRef  = useRef(false)

  const moveHandlersRef    = useRef([])
  const reactionHandlersRef = useRef([])
  const idleHandlersRef    = useRef([])
  const gameEndCallbackRef = useRef(null)

  // Last move event, replayed to newly-mounted subscribers so layout remounts
  // (e.g., PlatformShell focused↔chrome-present switch, which unmounts XOGame
  // because the parent frame component type changes) pick up the current
  // board state instead of reverting to an empty initialGameState().
  const lastMoveEventRef = useRef(null)

  // ── SDK object (stable reference — methods close over refs) ───────────────
  const sdk = useMemo(() => ({
    submitMove(move) {
      if (!slugRef.current) return
      rtFetch(`/rt/tables/${slugRef.current}/move`, { body: { cellIndex: move } })
        .catch(err => console.warn('[useGameSDK] move POST failed:', err?.status, err?.code, err?.message))
    },

    onMove(handler) {
      moveHandlersRef.current.push(handler)
      // Replay the most recent move event so a newly-mounted subscriber
      // hydrates to the current board state.
      if (lastMoveEventRef.current) handler({ ...lastMoveEventRef.current, replay: true })
      return () => {
        moveHandlersRef.current = moveHandlersRef.current.filter(h => h !== handler)
      }
    },

    signalEnd(result) {
      gameEndCallbackRef.current?.(result)
    },

    getPlayers() {
      return playersRef.current
    },

    getSettings() {
      return settingsRef.current
    },

    spectate(handler) {
      moveHandlersRef.current.push(handler)
      if (lastMoveEventRef.current) handler({ ...lastMoveEventRef.current, replay: true })
      return () => {
        moveHandlersRef.current = moveHandlersRef.current.filter(h => h !== handler)
      }
    },

    getPreviewState() {
      return { board: [...boardRef.current] }
    },

    getPlayerState(_playerId) {
      return { board: [...boardRef.current] }
    },

    forfeit() {
      if (!slugRef.current) return
      rtFetch(`/rt/tables/${slugRef.current}/forfeit`, { body: {} })
        .catch(err => console.warn('[useGameSDK] forfeit POST failed:', err?.status, err?.code, err?.message))
    },

    rematch() {
      if (!slugRef.current) return
      rtFetch(`/rt/tables/${slugRef.current}/rematch`, { body: {} })
        .catch(err => console.warn('[useGameSDK] rematch POST failed:', err?.status, err?.code, err?.message))
    },

    sendReaction(emoji) {
      if (!slugRef.current) return
      rtFetch(`/rt/tables/${slugRef.current}/reaction`, { body: { emoji } })
        .catch(err => console.warn('[useGameSDK] reaction POST failed:', err?.status, err?.code, err?.message))
    },

    idlePong() {
      if (!slugRef.current) return
      if (!currentUserRef.current?.id) return
      rtFetch(`/rt/tables/${slugRef.current}/idle/pong`, { method: 'POST' }).catch(() => {})
    },

    leaveTable() {
      if (!slugRef.current) return
      if (phaseRef.current === 'playing') {
        // Mid-game: forfeit so the opponent is notified immediately.
        // The forfeit lifecycle event drives the gameEnd callback.
        leavingRef.current = true
        rtFetch(`/rt/tables/${slugRef.current}/forfeit`, { body: {} })
          .catch(err => console.warn('[useGameSDK] forfeit POST failed:', err?.status, err?.code, err?.message))
      } else if (phaseRef.current === 'finished') {
        rtFetch(`/rt/tables/${slugRef.current}/leave`, { body: {} })
          .catch(err => console.warn('[useGameSDK] leave POST failed:', err?.status, err?.code, err?.message))
        gameEndCallbackRef.current?.({ leave: true })
      }
    },

    onReaction(handler) {
      reactionHandlersRef.current.push(handler)
      return () => {
        reactionHandlersRef.current = reactionHandlersRef.current.filter(h => h !== handler)
      }
    },

    onIdleWarning(handler) {
      idleHandlersRef.current.push(handler)
      return () => {
        idleHandlersRef.current = idleHandlersRef.current.filter(h => h !== handler)
      }
    },

    playSound(key) {
      useSoundStore.getState().play(key)
    },

    _onGameEnd(cb) {
      gameEndCallbackRef.current = cb
    },
  }), [])

  // ── SSE idle channel ──────────────────────────────────────────────────────
  // Server publishes warn events to `user:<id>:idle`; translate to the same
  // idleHandlersRef shape downstream UI expects.
  const idleChannel = currentUser?.id ? `user:${currentUser.id}:idle` : null
  useSseIdleWarning({
    enabled: !!idleChannel,
    channel: idleChannel,
    onWarn:  ({ secondsRemaining }) => {
      idleHandlersRef.current.forEach(h => h({ secondsRemaining }))
    },
  })

  // ── SSE+POST gameflow init ────────────────────────────────────────────────
  //
  // The HTTP response from POST /rt/tables (or /rt/tables/:slug/join) carries
  // the initial board + seat data so the joiner doesn't wait on an SSE round
  // trip to render. The per-table channels then drive everything else:
  //
  //   table:<id>:state     — kind ∈ {start, moved, forfeit}
  //   table:<id>:lifecycle — kind ∈ {cancelled, abandoned, guestJoined,
  //                                  spectatorJoined, playerDisconnected,
  //                                  playerReconnected, opponent_left}
  //   table:<id>:reaction  — { emoji, fromMark }
  useEffect(() => {
    perfMark('useGameSDK:effect-start', { gameId, joinSlug, tournamentMatchId })
    let cancelled = false
    let unsubSession = null

    function buildSession(overrides = {}) {
      const s = {
        tableId:       slugRef.current ?? '',
        gameId,
        players:       playersRef.current,
        currentUserId: currentUserRef.current?.id ?? null,
        isSpectator:   overrides.isSpectator ?? false,
        settings:      { ...settingsRef.current, marks: { ...marksRef.current } },
      }
      // Preserve identity when nothing meaningful changed — avoids re-renders.
      setSession(prev => {
        if (
          prev
          && prev.tableId       === s.tableId
          && prev.gameId        === s.gameId
          && prev.isSpectator   === s.isSpectator
          && prev.currentUserId === s.currentUserId
          && JSON.stringify(prev.players)  === JSON.stringify(s.players)
          && JSON.stringify(prev.settings) === JSON.stringify(s.settings)
        ) return prev
        return s
      })
      return s
    }

    function emitMoveEvent(move, state) {
      boardRef.current = state.board ?? boardRef.current
      const event = {
        playerId:  move !== null
          ? Object.entries(marksRef.current).find(([, m]) => m === state.board?.[move])?.[0] ?? null
          : null,
        move,
        state:     { ...state, marks: { ...marksRef.current } },
        timestamp: new Date().toISOString(),
      }
      lastMoveEventRef.current = event
      moveHandlersRef.current.forEach(h => h(event))
    }

    function applyCreateResultPvp({ slug, label, mark }) {
      const cu = currentUserRef.current
      slugRef.current = slug
      const hostId = cu?.id ?? 'host'
      marksRef.current[hostId] = mark
      playersRef.current = [{ id: hostId, displayName: cu?.displayName ?? 'You', isBot: false }]
      settingsRef.current = { label, myMark: mark }
      setPhase('waiting')
      buildSession({ isSpectator: false })
    }

    function applyCreateResultHvb({ slug, label, mark, board, currentTurn }) {
      const cu = currentUserRef.current
      slugRef.current = slug
      const hostId = cu?.id ?? 'host'
      const botId = botUserId ?? 'bot'
      marksRef.current[hostId] = mark
      marksRef.current[botId] = mark === 'X' ? 'O' : 'X'
      playersRef.current = [
        { id: hostId, displayName: cu?.displayName ?? 'You', isBot: false },
        { id: botId, displayName: 'Bot', isBot: true },
      ]
      settingsRef.current = { label, myMark: mark, isTournament: !!tournamentMatchId }
      boardRef.current = board ?? Array(9).fill(null)
      setPhase('playing')
      buildSession({ isSpectator: false })
      emitMoveEvent(null, {
        board:       boardRef.current,
        currentTurn: currentTurn ?? 'X',
        status:      'playing',
        winner:      null,
        winLine:     null,
        scores:      { X: 0, O: 0 },
        round:       1,
      })
    }

    function applyJoinResult({ slug, mark, action, room, startPayload }) {
      slugRef.current = slug
      const isSpectator = action === 'spectated_pvp'

      const hostId  = room?.hostUserId  ?? 'host'
      const guestId = room?.guestUserId ?? null
      if (mark) {
        marksRef.current[hostId] = 'X'
        if (guestId) marksRef.current[guestId] = 'O'
      }

      const cu = currentUserRef.current
      const hostPlayer = {
        id:            hostId,
        displayName:   room?.hostUserDisplayName ?? 'Host',
        isBot:         !!room?.hostUserIsBot,
        ownerUserId:   room?.hostUserOwnerBaId ?? null,
      }
      const guestPlayer = guestId ? {
        id:            guestId,
        displayName:   room?.guestUserDisplayName ?? cu?.displayName ?? 'Guest',
        isBot:         !!room?.guestUserIsBot,
        ownerUserId:   room?.guestUserOwnerBaId ?? null,
      } : null
      playersRef.current = guestPlayer ? [hostPlayer, guestPlayer] : [hostPlayer]
      settingsRef.current = {
        label:          room?.label,
        spectatorCount: room?.spectatorCount ?? 0,
        myMark:         isSpectator ? null : mark,
        isTournament:   !!tournamentMatchId,
      }

      // ACTIVE re-attach: skip waiting and synthesize a start event so the
      // game component renders immediately.
      const isReattach = action === 'reattached_active' && startPayload?.board
      if (isReattach) {
        boardRef.current = startPayload.board
        setPhase('playing')
        buildSession({ isSpectator: false })
        emitMoveEvent(null, {
          board:       startPayload.board,
          currentTurn: startPayload.currentTurn ?? 'X',
          status:      'playing',
          winner:      room?.winner  ?? null,
          winLine:     room?.winLine ?? null,
          scores:      room?.scores  ?? { X: 0, O: 0 },
          round:       startPayload.round ?? 1,
        })
        return
      }

      // Spectator joining a live game — render the current state.
      if (isSpectator && room?.board) {
        boardRef.current = room.board
        setPhase('playing')
        buildSession({ isSpectator: true })
        emitMoveEvent(null, {
          board:       room.board,
          currentTurn: room.currentTurn ?? 'X',
          status:      'playing',
          winner:      null,
          winLine:     null,
          scores:      room.scores ?? { X: 0, O: 0 },
          round:       room.round ?? 1,
        })
        return
      }

      setPhase(isSpectator ? 'playing' : 'waiting')
      buildSession({ isSpectator })
    }

    function waitForSseSession() {
      if (getSseSession()) return Promise.resolve()
      return new Promise((resolve, reject) => {
        let done = false
        let poll, timeout
        const cleanup = () => {
          clearInterval(poll)
          clearTimeout(timeout)
        }
        const finish = () => { if (done) return; done = true; cleanup(); resolve() }
        const rawUnsub = onSseSessionChange((id) => { if (id) finish() })
        unsubSession = () => { cleanup(); rawUnsub?.() }
        // Poll fallback — guards against a setSseSession() call that fires
        // between our cache read and the listener registration.
        poll = setInterval(() => {
          if (getSseSession()) finish()
        }, 50)
        timeout = setTimeout(() => {
          if (done) return
          done = true
          cleanup()
          reject(new Error('SSE session never arrived'))
        }, 10_000)
      })
    }

    ;(async () => {
      try {
        await waitForSseSession()
        if (cancelled) return

        if (joinSlug) {
          const role = spectate ? 'spectator' : 'player'
          const res = await rtFetch(`/rt/tables/${joinSlug}/join`, { body: { role } })
          if (cancelled) return
          applyJoinResult({
            slug:         joinSlug,
            mark:         res.mark,
            action:       res.action,
            room:         res.room,
            startPayload: res.startPayload,
          })
          if (res.tableId) setTableId(res.tableId)
        } else if (botUserId) {
          // HvB (free-play or MIXED tournament rematch).
          const res = await rtFetch('/rt/tables', {
            body: { kind: 'hvb', botUserId, tournamentMatchId, spectatorAllowed: true },
          })
          if (cancelled) return
          applyCreateResultHvb(res)
          // The HTTP response carries slug but not the canonical Table.id;
          // a follow-up join is idempotent for the creator and yields the id.
          const joined = await rtFetch(`/rt/tables/${res.slug}/join`, { body: { role: 'player' } })
            .catch(() => null)
          if (cancelled) return
          if (joined?.tableId) setTableId(joined.tableId)
        } else if (tournamentMatchId) {
          // HvH tournament: discover/seat through the match-table endpoint,
          // then complete the join to surface the room shape + tableId.
          const m = await rtFetch(`/rt/tournaments/matches/${tournamentMatchId}/table`, { body: {} })
          if (cancelled) return
          const j = await rtFetch(`/rt/tables/${m.slug}/join`, { body: { role: 'player' } })
          if (cancelled) return
          applyJoinResult({
            slug:         m.slug,
            mark:         j.mark ?? m.mark,
            action:       j.action,
            room:         j.room,
            startPayload: j.startPayload,
          })
          if (j.tableId) setTableId(j.tableId)
        } else {
          // PvP create.
          const res = await rtFetch('/rt/tables', { body: { kind: 'pvp', spectatorAllowed: true } })
          if (cancelled) return
          applyCreateResultPvp(res)
          const joined = await rtFetch(`/rt/tables/${res.slug}/join`, { body: { role: 'player' } })
            .catch(() => null)
          if (cancelled) return
          if (joined?.tableId) setTableId(joined.tableId)
        }
      } catch (err) {
        console.warn('[useGameSDK] init failed:', err?.status, err?.code, err?.message)
        if (err?.status === 404) {
          setAbandoned({ reason: 'stale', message: 'Game ended (idle). Returning…' })
        } else {
          setAbandoned({ reason: 'init-failed', message: err?.message ?? 'Failed to start game' })
        }
      }
    })()

    function onPageHide() {
      try {
        if (!slugRef.current) return
        if (phaseRef.current === 'playing') {
          rtFetch(`/rt/tables/${slugRef.current}/forfeit`, { body: {} }).catch(() => {})
        } else if (phaseRef.current === 'finished') {
          rtFetch(`/rt/tables/${slugRef.current}/leave`, { body: {} }).catch(() => {})
        }
      } catch (_) { /* nothing we can do during teardown */ }
    }
    window.addEventListener('pagehide', onPageHide)

    function autoIdlePong() {
      if (phaseRef.current !== 'playing') return
      if (!slugRef.current) return
      if (!currentUserRef.current?.id) return
      rtFetch(`/rt/tables/${slugRef.current}/idle/pong`).catch(() => {})
    }
    function onVisibilityShow() {
      if (document.visibilityState === 'visible') autoIdlePong()
    }
    document.addEventListener('visibilitychange', onVisibilityShow)
    window.addEventListener('focus', autoIdlePong)

    return () => {
      cancelled = true
      unsubSession?.()
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityShow)
      window.removeEventListener('focus', autoIdlePong)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, joinSlug, tournamentMatchId])

  // ── SSE channel subscription ──────────────────────────────────────────────
  // Stable channel filter — passed to the server-side `?channels=` filter.
  // Must NOT change after the EventSource opens, or the connection reopens
  // and the original SSE session (which holds this game's table seat) is
  // disposed mid-game. The broad `table:` prefix matches every table; we
  // narrow on the client by tableId in onEvent.
  const sseChannels = useMemo(() => ['table:'], [])
  // Dynamic listener set — picks up the per-table named events as soon as
  // the initial POST surfaces tableId, without reopening the connection.
  const sseEventTypes = useMemo(() => {
    if (!tableId) return []
    return [
      `table:${tableId}:state`,
      `table:${tableId}:lifecycle`,
      `table:${tableId}:reaction`,
    ]
  }, [tableId])

  useEventStream({
    enabled:    true,
    channels:   sseChannels,
    eventTypes: sseEventTypes,
    onEvent: (channel, payload) => {
      if (!channel || !tableId) return
      const tablePrefix = `table:${tableId}:`
      if (!channel.startsWith(tablePrefix)) return
      const topic = channel.slice(tablePrefix.length)

      if (topic === 'state') {
        const kind = payload?.kind
        if (kind === 'start') {
          boardRef.current = payload.board
          setPhase('playing')
          const event = {
            playerId:  null,
            move:      null,
            state: {
              board:       payload.board,
              currentTurn: payload.currentTurn ?? 'X',
              status:      'playing',
              winner:      null,
              winLine:     null,
              scores:      payload.scores ?? { X: 0, O: 0 },
              round:       payload.round ?? 1,
              marks:       { ...marksRef.current },
            },
            timestamp: new Date().toISOString(),
          }
          lastMoveEventRef.current = event
          moveHandlersRef.current.forEach(h => h(event))
          return
        }
        if (kind === 'moved') {
          const { cellIndex, board, currentTurn, status, winner, winLine, scores, round } = payload
          boardRef.current = board ?? boardRef.current
          setPhase(status === 'finished' ? 'finished' : 'playing')
          const event = {
            playerId: cellIndex !== null
              ? Object.entries(marksRef.current).find(([, m]) => m === board?.[cellIndex])?.[0] ?? null
              : null,
            move: cellIndex,
            state: {
              board, currentTurn, status, winner, winLine,
              scores: scores ?? { X: 0, O: 0 },
              round:  round  ?? 1,
              marks:  { ...marksRef.current },
            },
            timestamp: new Date().toISOString(),
          }
          lastMoveEventRef.current = event
          moveHandlersRef.current.forEach(h => h(event))
          return
        }
        if (kind === 'forfeit') {
          const { winner, scores, forfeiterMark, reason } = payload
          const event = {
            playerId: null,
            move:     null,
            state: {
              board:       boardRef.current,
              currentTurn: null,
              status:      'finished',
              winner:      winner ?? null,
              winLine:     null,
              scores:      scores ?? { X: 0, O: 0 },
              round:       null,
              marks:       { ...marksRef.current },
              // Pass forfeit context through so the game component can render
              // a "you win — opponent left" / "opponent disconnected" label
              // instead of a generic "Opponent wins!" pill that hides *why*
              // the game ended (Future_Ideas Known-Bugs §1 follow-up).
              endReason:     'forfeit',
              forfeiterMark: forfeiterMark ?? null,
              forfeitReason: reason        ?? null,
            },
            timestamp: new Date().toISOString(),
          }
          lastMoveEventRef.current = event
          moveHandlersRef.current.forEach(h => h(event))
          setPhase('finished')
          if (leavingRef.current) {
            leavingRef.current = false
            gameEndCallbackRef.current?.({ leave: true })
          }
          return
        }
        return
      }

      if (topic === 'lifecycle') {
        const kind = payload?.kind
        if (kind === 'cancelled') {
          setAbandoned({ reason: 'cancelled' })
          return
        }
        if (kind === 'abandoned') {
          setAbandoned({ reason: payload.reason, absentUserId: payload.absentUserId })
          return
        }
        if (kind === 'guestJoined' && payload.room) {
          if (payload.room.guestUserId) {
            const guestMark = 'O'
            marksRef.current[payload.room.guestUserId] = guestMark
            const existing = playersRef.current.find(p => p.id === payload.room.guestUserId)
            if (!existing) {
              playersRef.current = [
                ...playersRef.current,
                {
                  id:          payload.room.guestUserId,
                  displayName: payload.room.guestUserDisplayName ?? 'Guest',
                  isBot:       false,
                },
              ]
            }
            setSession(prev => prev ? { ...prev, players: playersRef.current, settings: { ...settingsRef.current, marks: { ...marksRef.current } } } : prev)
          }
          return
        }
        if (kind === 'spectatorJoined') {
          settingsRef.current = { ...settingsRef.current, spectatorCount: payload.spectatorCount }
          setSession(prev => prev ? { ...prev, settings: { ...settingsRef.current, marks: { ...marksRef.current } } } : prev)
          return
        }
        if (kind === 'playerDisconnected') {
          const prev = lastMoveEventRef.current?.state ?? {}
          const event = {
            playerId: null, move: null,
            state: {
              board:       boardRef.current ?? prev.board,
              currentTurn: prev.currentTurn ?? null,
              status:      'playing',
              winner:      null, winLine: null,
              scores:      prev.scores ?? { X: 0, O: 0 },
              round:       prev.round ?? 1,
              marks:       { ...marksRef.current },
            },
            timestamp: new Date().toISOString(),
          }
          lastMoveEventRef.current = event
          moveHandlersRef.current.forEach(h => h(event))
          return
        }
        if (kind === 'opponent_left') {
          setOpponentLeft(true)
          return
        }
        return
      }

      if (topic === 'reaction') {
        const { emoji, fromMark } = payload ?? {}
        // Don't fire my own reactions back into the local handler.
        const myMark = settingsRef.current?.myMark
        if (myMark && fromMark === myMark) return
        reactionHandlersRef.current.forEach(h => h({ emoji, fromMark }))
        return
      }
    },
  })

  return { session, sdk, phase, abandoned, kicked, seriesResult, opponentLeft }
}
