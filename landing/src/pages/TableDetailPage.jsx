// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Table detail page — Phase 3.2 + 3.3.
 *
 * Shows a single table's seats, status, and join/leave affordance for the
 * caller. Accepts all table IDs (including private ones) via direct URL —
 * the share-link mechanism for private tables.
 *
 * Phase 3.3: when the table's status is ACTIVE, the page renders through
 * PlatformShell so spectators and players see the unified chrome. The
 * shell currently shows a placeholder where the game component will load —
 * Phase 3.4 wires the live session state (today that state lives in the
 * in-memory Room layer, which Tables don't reach yet). FORMING/COMPLETED
 * states continue to use the seat-browsing UI since there's no game to
 * render.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { getToken } from '../lib/getToken.js'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { getSocket } from '../lib/socket.js'
import { useEventStream } from '../lib/useEventStream.js'
import PlatformShell from '../components/platform/PlatformShell.jsx'
import ShareTableButton from '../components/tables/ShareTableButton.jsx'
import { GameView } from './PlayPage.jsx'

const STATUS_META = {
  FORMING:   { label: 'Forming',   color: 'var(--color-amber-600)' },
  ACTIVE:    { label: 'In play',   color: 'var(--color-teal-600)'  },
  COMPLETED: { label: 'Completed', color: 'var(--color-slate-500)' },
}

function gameLabel(gameId) {
  return gameId === 'xo' ? 'XO (Tic-Tac-Toe)' : gameId
}

export default function TableDetailPage() {
  const { id: tableId } = useParams()
  const navigate = useNavigate()
  const { data: session } = useOptimisticSession()
  const currentUserId = session?.user?.id ?? null
  const isAdmin       = session?.user?.role === 'admin'

  const [table, setTable] = useState(null)   // null = loading
  const [error, setError] = useState(null)
  const [busy,  setBusy]  = useState(false)

  const load = useCallback(async () => {
    try {
      const token = await getToken().catch(() => null)
      const res = await api.tables.get(tableId, token)
      setTable(res.table)
      setError(null)
    } catch (err) {
      setError(err.status === 404 ? 'Table not found.' : (err.message || 'Failed to load table'))
      setTable({})   // sentinel so we stop showing the skeleton
    }
  }, [tableId])

  useEffect(() => { load() }, [load])

  // Presence: tell the backend we're watching this table. Re-emits on
  // reconnect via the 'connect' listener so counts stay accurate even after
  // a network hiccup. Guests can watch too (just don't fire spectator.joined
  // on the server side — see tablePresence.js).
  //
  // We also fire `table:unwatch` on `pagehide`, because the React cleanup
  // return is NOT guaranteed to run on tab close / navigation-away — and
  // without it the server only detects the disconnect when the polling
  // transport times out (~45s on default settings), leaving a stale
  // watcher in the count. `pagehide` fires reliably on close + refresh.
  useEffect(() => {
    const socket = getSocket()
    let cancelled = false

    async function emitWatch() {
      const token = await getToken().catch(() => null)
      if (cancelled) return
      socket.emit('table:watch', { tableId, authToken: token ?? null })
    }
    function emitUnwatch() {
      // socket.emit during pagehide is best-effort over polling — the XHR
      // may or may not flush. The server still catches orphans on socket
      // timeout, so this is a latency optimization, not a correctness fix.
      try { socket.emit('table:unwatch', { tableId }) } catch {}
    }

    emitWatch()
    socket.on('connect', emitWatch)
    window.addEventListener('pagehide', emitUnwatch)

    return () => {
      cancelled = true
      socket.off('connect', emitWatch)
      window.removeEventListener('pagehide', emitUnwatch)
      emitUnwatch()
    }
  }, [tableId])

  // Real-time: table.* bus events via SSE trigger a refetch when this table
  // is affected. table:presence stays on the socket — it's a per-table room
  // broadcast, not a Tier 2 SSE channel.
  const [presence, setPresence] = useState({ count: 0, userIds: [], spectatingCount: 0 })
  useEventStream({
    channels: ['guide:notification'],
    onEvent: (_channel, payload) => {
      const { type, payload: data } = payload ?? {}
      if (type === 'table.deleted' && data?.tableId === tableId) {
        navigate('/tables', { replace: true })
        return
      }
      if (!['player.joined', 'player.left', 'spectator.joined', 'table.empty', 'table.started'].includes(type)) return
      if (data?.tableId && data.tableId !== tableId) return
      load()
    },
  })
  useEffect(() => {
    const socket = getSocket()
    function onPresence(data) {
      if (data?.tableId !== tableId) return
      setPresence({ count: data.count ?? 0, userIds: data.userIds ?? [], spectatingCount: data.spectatingCount ?? 0 })
    }
    socket.on('table:presence', onPresence)
    return () => socket.off('table:presence', onPresence)
  }, [tableId])

  const mySeatIndex = table?.seats?.findIndex?.(s => s.userId && s.userId === currentUserId) ?? -1
  const isSeated    = mySeatIndex !== -1
  const seated      = Array.isArray(table?.seats) ? table.seats.filter(s => s?.status === 'occupied').length : 0
  const canJoin     = !!currentUserId && !isSeated && table?.status === 'FORMING' && seated < (table?.maxPlayers ?? 0)
  const canLeave    = isSeated && table?.status !== 'COMPLETED'
  const isCreator   = !!currentUserId && table?.createdById === currentUserId
  // Delete allowed for creator-owned, non-tournament tables that aren't mid-game.
  const canDelete   = isCreator && !table?.isTournament && table?.status !== 'ACTIVE'

  async function handleJoin(seatIndex) {
    setBusy(true); setError(null)
    try {
      const token = await getToken()
      if (!token) throw new Error('Sign in to join a table.')
      // seatIndex is optional: if provided, server places us there; otherwise
      // server picks the first empty seat (used by the header "Take a seat"
      // button when the caller hasn't specified which seat).
      const opts = typeof seatIndex === 'number' ? { seatIndex } : null
      const res = await api.tables.join(tableId, opts, token)
      setTable(res.table)
    } catch (err) {
      setError(err.message || 'Join failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleLeave() {
    setBusy(true); setError(null)
    try {
      const token = await getToken()
      if (!token) throw new Error('Sign in to leave.')
      const res = await api.tables.leave(tableId, token)
      setTable(res.table)
    } catch (err) {
      setError(err.message || 'Leave failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleStopGame() {
    if (!window.confirm('Force-stop this game? Players will be returned to the tables list.')) return
    setBusy(true); setError(null)
    try {
      const token = await getToken()
      await api.admin.stopTable(tableId, token)
      // The bus event (table.deleted) will navigate everyone away automatically.
    } catch (err) {
      setError(err.message || 'Stop failed')
      setBusy(false)
    }
  }

  async function handleDelete() {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete this table? This cannot be undone.')) return
    setBusy(true); setError(null)
    try {
      const token = await getToken()
      if (!token) throw new Error('Sign in to delete.')
      await api.tables.delete(tableId, token)
      navigate('/tables', { replace: true })
    } catch (err) {
      setError(err.message || 'Delete failed')
      setBusy(false)
    }
  }

  if (table === null) {
    return (
      <div className="max-w-2xl mx-auto w-full px-4 py-8">
        <div className="card p-6 h-40" style={{ background: 'var(--bg-surface-hover)', opacity: 0.6 }} />
      </div>
    )
  }

  if (!table?.id) {
    return (
      <div className="max-w-2xl mx-auto w-full px-4 py-12 text-center space-y-3">
        <p className="text-lg font-semibold">Table not found</p>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {error || 'It may have been cancelled or the link is wrong.'}
        </p>
        <button onClick={() => navigate(-1)} className="btn btn-primary btn-sm">Back to Tables</button>
      </div>
    )
  }

  const meta = STATUS_META[table.status] ?? STATUS_META.COMPLETED

  // Phase 3.3: ACTIVE tables route through the platform shell. The shell
  // renders its standard chrome (game column + table context sidebar with
  // seated players, spectator count, Gym/Puzzles tabs), and a placeholder
  // sits where the live game component will load once Phase 3.4 bridges
  // Tables to the realtime session layer.
  if (table.status === 'ACTIVE') {
    const gameKey = session?.user?.id ?? 'guest'
    // Spectating count is tracked independently by the backend via _spectatorSockets
    // (populated when room:join fires with role:'spectator'), so it's accurate even
    // when players joined via /play?join=slug and never emitted table:watch.
    const spectatingCount = presence.spectatingCount ?? 0
    return (
      <>
        <GameView
          key={gameKey}
          joinSlug={table.slug}
          authSession={session}
          botConfig={null}
          spectatingCount={spectatingCount}
        />
        {isAdmin && (
          <div className="fixed bottom-4 right-4 z-50">
            <button
              onClick={handleStopGame}
              disabled={busy}
              className="btn btn-primary btn-sm shadow-lg"
            >
              Stop game
            </button>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="max-w-2xl mx-auto w-full px-4 py-8 space-y-6">
      <header className="flex items-start justify-between gap-3 pb-4 border-b"
              style={{ borderColor: 'var(--border-default)' }}>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold truncate" style={{ fontFamily: 'var(--font-display)' }}>
            {gameLabel(table.gameId)}
          </h1>
          {(() => {
            // "Watching" = other people, not the viewer themselves. If the
            // caller is signed in and in the presence userIds, subtract 1
            // from the count so "3 tabs of me alone" reads 0, not 1.
            return (
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Table · {seated} / {table.maxPlayers} seated
                {table.isPrivate    && ' · Private'}
                {table.isTournament && ' · Tournament'}
              </p>
            )
          })()}
        </div>
        <span
          className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold"
          style={{ background: 'var(--bg-surface-hover)', color: meta.color }}
        >
          {meta.label}
        </span>
      </header>

      {(() => {
        // Two audiences for the FORMING banner:
        //  - Seated players ("waiting"): need a nudge to share the link.
        //  - Visitors with a seat available: just need a clear call to sit.
        // Anyone else (full table about to flip ACTIVE, etc.) gets no banner.
        if (table.status !== 'FORMING') return null
        if (seated === 0 || seated >= (table?.maxPlayers ?? 0)) return null

        const headline = isSeated
          ? 'Waiting for opponent to join…'
          : 'Take a seat to join this game'
        const subtext = isSeated
          ? "Share this table's link (Share button below) to invite someone."
          : canJoin
            ? 'Click any empty seat below.'
            : 'Sign in to claim a seat.'

        return (
          <div
            className="flex items-center gap-3 rounded-xl px-4 py-3"
            style={{
              background:  'rgba(217, 119, 6, 0.10)',
              border:      '1px solid rgba(217, 119, 6, 0.25)',
              color:       'var(--text-primary)',
            }}
            role="status"
            aria-live="polite"
          >
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
                    style={{ background: 'var(--color-amber-500, #f59e0b)' }} />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5"
                    style={{ background: 'var(--color-amber-600, #d97706)' }} />
            </span>
            <p className="text-sm">
              <span className="font-semibold">{headline}</span>
              {' '}
              <span style={{ color: 'var(--text-secondary)' }}>{subtext}</span>
            </p>
          </div>
        )
      })()}

      <section>
        <h2 className="text-xs uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Seats</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {table.seats?.map((seat, i) => {
            // Symmetric seat-click behavior:
            //  - empty seat + canJoin  → click to take
            //  - my occupied seat + canLeave → click to leave
            //  - any other occupied seat → static (display only)
            //  - empty seat when I can't join → static
            const seatOccupied = seat.status === 'occupied'
            const isMine       = seatOccupied && seat.userId === currentUserId
            const takeable     = !seatOccupied && canJoin && !busy
            const leaveable    = isMine && canLeave && !busy
            const clickable    = takeable || leaveable
            // Bind the seat index so the server places us in the seat we clicked,
            // not just the first empty one.
            const onSeatClick  = takeable ? () => handleJoin(i) : leaveable ? handleLeave : undefined
            const commonStyle  = {
              borderColor: seatOccupied ? 'var(--color-teal-500)' : 'var(--border-default)',
            }
            const content = (
              <>
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{
                    background: seatOccupied ? 'var(--color-teal-500)' : 'var(--bg-surface-hover)',
                    color:      seatOccupied ? 'white' : 'var(--text-muted)',
                  }}>
                  {i + 1}
                </span>
                <div className="text-sm flex-1 min-w-0">
                  {seatOccupied ? (
                    <span className="truncate">
                      {isMine
                        ? (leaveable ? 'You — click to leave' : 'You')
                        : (seat.displayName ?? `User ${(seat.userId ?? '').slice(0, 8)}`)}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>
                      {takeable ? 'Take this seat' : 'Empty seat'}
                    </span>
                  )}
                </div>
              </>
            )

            if (clickable) {
              const label = takeable ? `Take seat ${i + 1}` : `Leave seat ${i + 1}`
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={onSeatClick}
                    disabled={busy}
                    className="card p-3 flex items-center gap-3 w-full text-left transition-colors hover:bg-[var(--bg-surface-hover)] cursor-pointer"
                    style={commonStyle}
                    aria-label={label}
                  >
                    {content}
                  </button>
                </li>
              )
            }

            return (
              <li
                key={i}
                className="card p-3 flex items-center gap-3"
                style={commonStyle}
              >
                {content}
              </li>
            )
          })}
        </ul>
      </section>

      {error && (
        <p className="rounded-lg px-3 py-2 text-sm"
           style={{ background: 'var(--color-red-50)', color: 'var(--color-red-700)' }}>
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Creator-only delete on the left so it's out of the way of the
            primary join/leave actions on the right. */}
        <div className="flex items-center gap-2">
          {canDelete && (
            <button
              onClick={handleDelete}
              disabled={busy}
              className="btn btn-primary btn-sm"
              title="Delete this table (creator only)"
            >
              Delete table
            </button>
          )}
          {isAdmin && !canDelete && table.status !== 'COMPLETED' && (
            <button
              onClick={handleStopGame}
              disabled={busy}
              className="btn btn-primary btn-sm"
              title="Admin: force-stop this table"
            >
              Stop game
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => navigate(-1)} className="btn btn-ghost btn-sm">Back</button>
          <ShareTableButton tableId={tableId} variant="full" />
          {canLeave && (
            <button onClick={handleLeave} disabled={busy} className="btn btn-secondary btn-sm">
              {busy ? 'Leaving…' : 'Leave seat'}
            </button>
          )}
          {canJoin && (
            <button onClick={handleJoin} disabled={busy} className="btn btn-primary btn-sm">
              {busy ? 'Joining…' : 'Take a seat'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
