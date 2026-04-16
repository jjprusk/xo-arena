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
import PlatformShell from '../components/platform/PlatformShell.jsx'
import ShareTableButton from '../components/tables/ShareTableButton.jsx'

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
  useEffect(() => {
    const socket = getSocket()
    let cancelled = false

    async function emitWatch() {
      const token = await getToken().catch(() => null)
      if (cancelled) return
      socket.emit('table:watch', { tableId, authToken: token ?? null })
    }

    emitWatch()
    socket.on('connect', emitWatch)

    return () => {
      cancelled = true
      socket.off('connect', emitWatch)
      socket.emit('table:unwatch', { tableId })
    }
  }, [tableId])

  // Real-time: listen to table.* bus events and the table:presence feed,
  // refreshing when this specific table is affected.
  const [presence, setPresence] = useState({ count: 0, userIds: [] })
  useEffect(() => {
    const socket = getSocket()
    function onBusEvent({ type, payload }) {
      // If this specific table was deleted (by the creator or admin), bounce
      // back to the Tables list — no point staying on a 404 page.
      if (type === 'table.deleted' && payload?.tableId === tableId) {
        navigate('/tables', { replace: true })
        return
      }
      if (!['player.joined', 'spectator.joined', 'table.empty'].includes(type)) return
      if (payload?.tableId && payload.tableId !== tableId) return
      load()
    }
    function onPresence(data) {
      if (data?.tableId !== tableId) return
      setPresence({ count: data.count ?? 0, userIds: data.userIds ?? [] })
    }
    socket.on('guide:notification', onBusEvent)
    socket.on('table:presence',     onPresence)
    return () => {
      socket.off('guide:notification', onBusEvent)
      socket.off('table:presence',     onPresence)
    }
  }, [tableId, load])

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
        <Link to="/tables" className="btn btn-primary btn-sm">Back to Tables</Link>
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
    // Synthesise the minimal session shape PlatformShell needs: it only
    // reads players + isSpectator. When 3.4 lands, this comes from the
    // useGameSDK hook driven off db.table instead of in-memory rooms.
    const shellSession = {
      isSpectator: !isSeated,
      players: (table.seats ?? [])
        .filter(s => s.status === 'occupied' && s.userId)
        .map(s => ({
          id:          s.userId,
          displayName: s.userId === currentUserId ? 'You' : `User ${s.userId.slice(0, 8)}`,
          isBot:       false,
        })),
    }
    const shellMeta = {
      id:               table.gameId,
      title:            gameLabel(table.gameId),
      layout:           { preferredWidth: 'standard' },
      supportsTraining: table.gameId === 'xo',  // driven off game registry in 3.4
      supportsPuzzles:  table.gameId === 'xo',
    }
    return (
      <PlatformShell
        gameMeta={shellMeta}
        session={shellSession}
        phase="playing"
        table={table}
        spectatorCount={presence.count}
        backHref="/tables"
        onLeave={canLeave ? handleLeave : undefined}
        // Force chrome-present until Phase 3.4 bridges the real game session.
        // Without a live board to render, focused mode just shows a placeholder
        // alone on the page — chrome-present is more useful (context sidebar
        // is the main content for now).
        initialMode="chrome-present"
      >
        <div className="card p-8 text-center space-y-2"
             style={{ background: 'var(--bg-surface)', minHeight: 260 }}>
          <div className="text-3xl">🎮</div>
          <p className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
            Game is active
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            The game session lives in the realtime Room layer today. Phase 3.4
            wires Tables to Rooms so the board renders here directly.
          </p>
        </div>
      </PlatformShell>
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
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Table · {seated} / {table.maxPlayers} seated
            {presence.count > 0 && ` · ${presence.count} watching`}
            {table.isPrivate   && ' · Private'}
            {table.isTournament && ' · Tournament'}
          </p>
        </div>
        <span
          className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold"
          style={{ background: 'var(--bg-surface-hover)', color: meta.color }}
        >
          {meta.label}
        </span>
      </header>

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
                      {isMine ? (leaveable ? 'You — click to leave' : 'You') : `User ${(seat.userId ?? '').slice(0, 8)}`}
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
        <div>
          {canDelete && (
            <button
              onClick={handleDelete}
              disabled={busy}
              className="text-sm px-3 py-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-surface-hover)]"
              style={{ color: 'var(--color-red-700)', borderColor: 'var(--color-red-200, var(--border-default))' }}
              title="Delete this table (creator only)"
            >
              Delete table
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/tables" className="btn btn-ghost btn-sm">Back</Link>
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
