// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { useState, useEffect, useRef, useMemo } from 'react'
import { connectSocket, disconnectSocket, getSocket } from './socket.js'
import { getToken } from './getToken.js'
import { useSoundStore } from '../store/soundStore.js'
import { perfMark } from './perfLog.js'

/**
 * Platform-side SDK provider for socket-based games.
 *
 * Creates the GameSession and GameSDK objects and bridges them to the
 * existing socket infrastructure. Games receive { session, sdk } as props
 * and never interact with sockets, auth, or platform internals directly.
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
  botSkillId      = null,
}) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [phase, setPhase]           = useState('connecting')   // connecting | waiting | playing | finished
  const [session, setSession]       = useState(null)
  const [abandoned, setAbandoned]   = useState(null)
  const [kicked, setKicked]         = useState(false)
  const [seriesResult, setSeriesResult] = useState(null)

  // currentUser in a ref so auth changes don't re-trigger the socket effect.
  // The effect reads currentUserRef.current so it always has the latest value.
  const currentUserRef = useRef(currentUser)
  currentUserRef.current = currentUser

  // Mutable state tracked in refs so sdk callbacks always have fresh values
  const boardRef    = useRef(Array(9).fill(null))
  const marksRef    = useRef({})          // { [userId]: 'X' | 'O' }
  const playersRef  = useRef([])
  const settingsRef = useRef({})
  const slugRef     = useRef(null)

  // Registered move handlers (from sdk.onMove / sdk.spectate)
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
    // ── Core contract methods ──────────────────────────────────────────────

    submitMove(move) {
      getSocket().emit('game:move', { cellIndex: move })
    },

    onMove(handler) {
      moveHandlersRef.current.push(handler)
      // Replay the most recent move event so a newly-mounted subscriber
      // (fresh XOGame instance after a shell mode switch, for example)
      // hydrates to the current board state instead of showing an empty
      // initialGameState. `replay: true` tells the consumer to update state
      // but skip side effects (sounds, signalEnd, last-cell animations).
      if (lastMoveEventRef.current) handler({ ...lastMoveEventRef.current, replay: true })
      return () => {
        moveHandlersRef.current = moveHandlersRef.current.filter(h => h !== handler)
      }
    },

    signalEnd(result) {
      // Server already recorded the game. Notify platform shell for UI cleanup.
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
      // Same rehydration logic as onMove — covers spectator remounts too.
      if (lastMoveEventRef.current) handler({ ...lastMoveEventRef.current, replay: true })
      return () => {
        moveHandlersRef.current = moveHandlersRef.current.filter(h => h !== handler)
      }
    },

    getPreviewState() {
      return { board: [...boardRef.current] }
    },

    getPlayerState(_playerId) {
      // XO is fully public — all players see the same state
      return { board: [...boardRef.current] }
    },

    // ── XO-specific extensions (not in base contract) ──────────────────────

    forfeit() {
      getSocket().emit('game:forfeit')
    },

    rematch() {
      getSocket().emit('game:rematch')
    },

    sendReaction(emoji) {
      getSocket().emit('game:reaction', { emoji })
    },

    idlePong() {
      getSocket().emit('idle:pong')
    },

    leaveTable() {
      // Handled by PlayPage navigation
      gameEndCallbackRef.current?.({ leave: true })
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

    // ── Platform audio ─────────────────────────────────────────────────────
    // Games route all sound through this — platform owns the AudioContext
    // (mute, volume, suspend/resume lifecycle). Unknown keys are a no-op.

    playSound(key) {
      useSoundStore.getState().play(key)
    },

    // Register platform shell game-end callback
    _onGameEnd(cb) {
      gameEndCallbackRef.current = cb
    },
  }), [])

  // ── Socket lifecycle ───────────────────────────────────────────────────────
  useEffect(() => {
    perfMark('useGameSDK:effect-start', { gameId, joinSlug, tournamentMatchId })
    const socket = connectSocket()
    perfMark('useGameSDK:after-connectSocket', socket.connected ? 'already-connected' : 'connecting')

    // ── Helpers ──────────────────────────────────────────────────────────────

    function buildSession(overrides = {}) {
      const s = {
        tableId:       slugRef.current ?? '',
        gameId,
        players:       playersRef.current,
        currentUserId: currentUserRef.current?.id ?? null,
        isSpectator:   overrides.isSpectator ?? false,
        settings:      { ...settingsRef.current, marks: { ...marksRef.current } },
      }
      // Preserve object identity when nothing meaningful changed — avoids a
      // re-render of the game component on every socket event. Scalars are
      // compared directly; players/settings (small objects/arrays) use
      // JSON.stringify — cheap at this scale and exact.
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
      // Save for replay to handlers that subscribe later (e.g., a remounted
      // XOGame after the PlatformShell mode switch).
      lastMoveEventRef.current = event
      moveHandlersRef.current.forEach(h => h(event))
    }

    // ── Room events ───────────────────────────────────────────────────────────

    socket.on('room:created', ({ slug, displayName, mark }) => {
      const cu = currentUserRef.current
      slugRef.current = slug
      const hostId = cu?.id ?? 'host'
      marksRef.current[hostId] = mark
      playersRef.current = [{ id: hostId, displayName: cu?.displayName ?? 'You', isBot: false }]
      settingsRef.current = { displayName, myMark: mark }
      setPhase('waiting')
      buildSession({ isSpectator: false })
    })

    socket.on('room:created:hvb', ({ slug, displayName, mark, board, currentTurn }) => {
      perfMark('useGameSDK:room:created:hvb')
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
      settingsRef.current = { displayName, myMark: mark }
      boardRef.current = board
      setPhase('playing')
      buildSession({ isSpectator: false })
      emitMoveEvent(null, {
        board,
        currentTurn: currentTurn ?? 'X',
        status: 'playing',
        winner: null,
        winLine: null,
        scores: { X: 0, O: 0 },
        round: 1,
      })
    })

    socket.on('room:renamed', ({ slug, displayName }) => {
      slugRef.current = slug
      settingsRef.current = { ...settingsRef.current, displayName }
      buildSession()
    })

    socket.on('room:joined', ({ slug, role, mark, room }) => {
      slugRef.current = slug
      const isSpectator = role === 'spectator'

      const cu = currentUserRef.current
      const guestId = cu?.id ?? 'guest'
      if (mark) {
        marksRef.current[guestId] = mark
        // Derive host's mark (opposite of guest)
        const hostMark = mark === 'O' ? 'X' : 'O'
        const hostId = room?.hostUserId ?? 'host'
        marksRef.current[hostId] = hostMark
      }

      const hostPlayer = {
        id:          room?.hostUserId ?? 'host',
        displayName: room?.hostUserDisplayName ?? 'Host',
        isBot:       false,
      }
      const guestPlayer = { id: guestId, displayName: cu?.displayName ?? 'You', isBot: false }

      playersRef.current = isSpectator ? [hostPlayer] : [hostPlayer, guestPlayer]
      settingsRef.current = {
        displayName:    room?.displayName,
        spectatorCount: room?.spectatorCount ?? 0,
        myMark:         isSpectator ? null : mark,
      }

      setPhase(isSpectator ? 'playing' : 'waiting')
      buildSession({ isSpectator })

      // Spectator joins mid-game — emit current state as a start event
      if (isSpectator && room?.board) {
        boardRef.current = room.board
        emitMoveEvent(null, {
          board:       room.board,
          currentTurn: room.currentTurn ?? 'X',
          status:      'playing',
          winner:      null,
          winLine:     null,
          scores:      room.scores ?? { X: 0, O: 0 },
          round:       room.round ?? 1,
        })
      }
    })

    socket.on('room:guestJoined', ({ room }) => {
      // Host side: learn the guest's identity
      if (room?.guestUserId) {
        const guestMark = 'O'
        marksRef.current[room.guestUserId] = guestMark
        const existing = playersRef.current.find(p => p.id === room.guestUserId)
        if (!existing) {
          playersRef.current = [
            ...playersRef.current,
            { id: room.guestUserId, displayName: room.guestUserDisplayName ?? 'Guest', isBot: false },
          ]
        }
        buildSession()
      }
    })

    socket.on('room:spectatorJoined', ({ spectatorCount }) => {
      settingsRef.current = { ...settingsRef.current, spectatorCount }
    })

    socket.on('room:playerDisconnected', () => {
      // Surface as error state — game component shows a notice
      emitMoveEvent(null, {
        ...(boardRef.current ? { board: boardRef.current } : {}),
        status: 'playing',
        error:  'Opponent disconnected. Waiting 60s for reconnect…',
      })
    })

    socket.on('room:cancelled', () => {
      setAbandoned({ reason: 'cancelled' })
    })

    socket.on('room:abandoned', ({ reason, absentUserId }) => {
      setAbandoned({ reason, absentUserId })
    })

    socket.on('room:kicked', ({ reason }) => {
      setKicked(reason === 'idle')
    })

    // ── Game events ────────────────────────────────────────────────────────────

    socket.on('game:start', ({ board, currentTurn, round, scores }) => {
      boardRef.current = board
      setPhase('playing')
      buildSession()
      // Emit a synthetic start event (move: null) so the game component resets
      emitMoveEvent(null, {
        board,
        currentTurn: currentTurn ?? 'X',
        status:      'playing',
        winner:      null,
        winLine:     null,
        scores:      scores ?? { X: 0, O: 0 },
        round:       round ?? 1,
      })
    })

    socket.on('game:moved', ({ cellIndex, board, currentTurn, status, winner, winLine, scores, round }) => {
      setPhase(status === 'finished' ? 'finished' : 'playing')
      emitMoveEvent(cellIndex, { board, currentTurn, status, winner, winLine, scores, round })
    })

    socket.on('game:forfeit', ({ winner, scores }) => {
      emitMoveEvent(null, {
        board:       boardRef.current,
        currentTurn: null,
        status:      'finished',
        winner,
        winLine:     null,
        scores,
        round:       null,
      })
      setPhase('finished')
    })

    // ── Reaction + idle ────────────────────────────────────────────────────────

    socket.on('game:reaction', ({ emoji, fromMark }) => {
      reactionHandlersRef.current.forEach(h => h({ emoji, fromMark }))
    })

    socket.on('idle:warning', ({ secondsRemaining }) => {
      idleHandlersRef.current.forEach(h => h({ secondsRemaining }))
    })

    // ── Tournament series ──────────────────────────────────────────────────────

    socket.on('tournament:series:complete', (data) => {
      if (!tournamentMatchId || data.matchId === tournamentMatchId) {
        setSeriesResult(data)
      }
    })

    // ── Error ──────────────────────────────────────────────────────────────────

    socket.on('error', ({ message }) => {
      // Room full when joining as player — fall back to spectator
      const state = { slug: slugRef.current, role: session?.isSpectator ? 'spectator' : 'guest' }
      if (
        !session?.isSpectator &&
        (message === 'Room is not waiting for a player' || message === 'Room is full')
      ) {
        socket.emit('room:join', { slug: state.slug, role: 'spectator' })
        return
      }
      // "Room not found" happens when the server-side room has been cleaned
      // up (idle abandonment after game.idleWarnSeconds + game.idleGraceSeconds
      // = 3 min default, or socket reconnected with a new socket.id that the
      // room no longer recognizes). Without this branch, clicks after the
      // room is gone silently fail — sound plays, no move, no feedback.
      // Surface as the same "abandoned" state the room:abandoned event uses
      // so PlayPage's existing cleanup path runs.
      if (message === 'Room not found') {
        setAbandoned({ reason: 'stale', message: 'Game ended (idle). Returning…' })
        return
      }
      // Any other unrecognized error: log to the console so it's visible in
      // devtools instead of eaten silently. Pre-existing behavior swallowed
      // everything, which is how this bug hid.
      // eslint-disable-next-line no-console
      console.warn('[useGameSDK] unhandled socket error:', message)
    })

    // ── Initial join / create ──────────────────────────────────────────────────

    // Guard: ensure we only emit once per effect run even if 'connect' fires
    // multiple times or the effect is double-invoked in React Strict Mode.
    let emitted = false
    function emitRoomAction(token) {
      if (emitted) return
      emitted = true
      perfMark('useGameSDK:emitRoomAction', { hasToken: !!token, botUserId, joinSlug })
      if (tournamentMatchId) {
        socket.emit('tournament:room:join', { matchId: tournamentMatchId, authToken: token ?? null })
      } else if (joinSlug) {
        socket.emit('room:join', { slug: joinSlug, role: 'player', authToken: token ?? null })
      } else if (botUserId) {
        socket.emit('room:create:hvb', { botUserId, botSkillId: botSkillId ?? null, authToken: token ?? null })
      } else {
        socket.emit('room:create', { spectatorAllowed: true, authToken: token ?? null })
      }
    }

    // Must wait for the socket to be fully connected before emitting —
    // emitting before 'connect' fires is silently dropped by socket.io.
    //
    // Use socket.on (not socket.once) so that a disconnect-reconnect cycle
    // while still in the 'connecting' phase re-emits the room action.
    // Guard: only re-emit if we haven't received a room slug yet (slugRef is null),
    // so a reconnect mid-game never accidentally creates a second room.
    // Skip the /api/token round trip for guests — we already know there's no
    // auth to send. Eliminates an async hop on the /play hot path.
    function resolveAndEmit() {
      if (!currentUserRef.current?.id) {
        emitRoomAction(null)
      } else {
        getToken().then(emitRoomAction)
      }
    }

    function onConnect() {
      perfMark('useGameSDK:socket-connect-fired')
      // Always reset the guard on reconnect. If the user has an existing
      // game (slugRef set), the server's tryReconnect() will detect the
      // pending disconnect timer and rejoin the game instead of creating
      // a new one. Without this reset, the emitted guard prevents ANY
      // re-emit and the client sits frozen after a socket reconnect
      // (e.g., macOS desktop switch triggers Safari disconnect).
      emitted = false
      resolveAndEmit()
    }

    socket.on('connect', onConnect)
    if (socket.connected) {
      perfMark('useGameSDK:socket-already-connected')
      resolveAndEmit()
    }

    return () => {
      // Cancel pending connect handler and all event listeners
      socket.off('connect', onConnect)
      emitted = true // prevent any in-flight getToken().then from emitting after cleanup
      ;[
        'room:created', 'room:created:hvb', 'room:renamed', 'room:joined', 'room:guestJoined',
        'room:spectatorJoined', 'room:playerDisconnected', 'room:playerReconnected',
        'room:cancelled', 'room:abandoned', 'room:kicked',
        'game:start', 'game:moved', 'game:forfeit',
        'game:reaction', 'idle:warning',
        'tournament:series:complete', 'error',
      ].forEach(ev => socket.off(ev))
      // Cleanup note: we do NOT emit room:cancel here. SPA navigation keeps
      // the socket alive, and the room:cancel can race with a re-mount
      // (StrictMode or fast back-navigation). Instead, the server-side
      // room:create / room:create:hvb handler detects the stale table via
      // _socketToTable and cleans it up before creating the new one.
    }
  // currentUser intentionally omitted — it's accessed via currentUserRef.current
  // so auth changes don't tear down and re-register socket listeners.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, joinSlug, tournamentMatchId])

  return { session, sdk, phase, abandoned, kicked, seriesResult }
}
