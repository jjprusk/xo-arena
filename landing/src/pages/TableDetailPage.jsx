// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Table detail page — Phase 3.2.
 *
 * Shows a single table's seats, status, and join/leave affordance for the
 * caller. Accepts all table IDs (including private ones) via direct URL —
 * the share-link mechanism for private tables.
 *
 * TODO Phase 3.3: this page is currently a static detail view; the platform
 * shell phase (3.3) turns it into the live game container that loads the
 * game component via React.lazy once status flips to ACTIVE.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { getToken } from '../lib/getToken.js'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { getSocket } from '../lib/socket.js'

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

  async function handleJoin() {
    setBusy(true); setError(null)
    try {
      const token = await getToken()
      if (!token) throw new Error('Sign in to join a table.')
      const res = await api.tables.join(tableId, token)
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
          {table.seats?.map((seat, i) => (
            <li key={i}
                className="card p-3 flex items-center gap-3"
                style={{
                  borderColor: seat.status === 'occupied' ? 'var(--color-teal-500)' : 'var(--border-default)',
                }}>
              <span
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  background: seat.status === 'occupied' ? 'var(--color-teal-500)' : 'var(--bg-surface-hover)',
                  color:      seat.status === 'occupied' ? 'white' : 'var(--text-muted)',
                }}>
                {i + 1}
              </span>
              <div className="text-sm">
                {seat.status === 'occupied' ? (
                  <span>
                    {seat.userId === currentUserId ? 'You' : `User ${(seat.userId ?? '').slice(0, 8)}`}
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>Empty seat</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {error && (
        <p className="rounded-lg px-3 py-2 text-sm"
           style={{ background: 'var(--color-red-50)', color: 'var(--color-red-700)' }}>
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link to="/tables" className="btn btn-ghost btn-sm">Back</Link>
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
  )
}
