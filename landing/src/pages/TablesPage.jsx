// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tables page — Phase 3.2.
 *
 * Live list of open public tables with filters + a "Create table" flow.
 * Tables: FORMING / ACTIVE / COMPLETED. Private tables are excluded from
 * this list but reachable by direct URL (/tables/:id).
 *
 * Real-time updates land in a follow-up commit (listens to the
 * table.created / player.joined / table.empty bus events via
 * guide:notification).
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { getToken } from '../lib/getToken.js'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { value: '',          label: 'All'        },
  { value: 'FORMING',   label: 'Forming'    },
  { value: 'ACTIVE',    label: 'In play'    },
  { value: 'COMPLETED', label: 'Completed'  },
]

const STATUS_META = {
  FORMING:   { label: 'Forming',    color: 'var(--color-amber-600)', bg: 'rgba(217, 119, 6, 0.08)' },
  ACTIVE:    { label: 'In play',    color: 'var(--color-teal-600)',  bg: 'rgba(13, 148, 136, 0.08)' },
  COMPLETED: { label: 'Completed',  color: 'var(--color-slate-500)', bg: 'rgba(100, 116, 139, 0.08)' },
}

// Games available to create a table for. Add entries here as new games ship.
const GAME_OPTIONS = [
  { id: 'xo', label: 'XO (Tic-Tac-Toe)', minPlayers: 2, maxPlayers: 2 },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function countSeated(seats) {
  if (!Array.isArray(seats)) return 0
  return seats.filter(s => s?.status === 'occupied').length
}

function gameLabel(gameId) {
  return GAME_OPTIONS.find(g => g.id === gameId)?.label ?? gameId
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TablesPage() {
  const { data: session } = useOptimisticSession()
  const isSignedIn = !!session?.user

  const [tables, setTables]       = useState(null)  // null = loading, [] = empty
  const [error, setError]         = useState(null)
  const [statusFilter, setStatus] = useState('')
  const [gameFilter,   setGame]   = useState('')
  const [showCreate,   setShowCreate] = useState(false)

  const fetchTables = useCallback(async () => {
    try {
      const token = await getToken().catch(() => null)
      const opts = {}
      if (statusFilter) opts.status = statusFilter
      if (gameFilter)   opts.gameId = gameFilter
      const res = await api.tables.list(opts, token)
      setTables(res.tables ?? [])
      setError(null)
    } catch (err) {
      setError(err.message || 'Failed to load tables')
    }
  }, [statusFilter, gameFilter])

  useEffect(() => { fetchTables() }, [fetchTables])

  return (
    <div className="max-w-4xl mx-auto w-full px-4 py-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b"
              style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>Tables</h1>
        {isSignedIn && (
          <button onClick={() => setShowCreate(true)} className="btn btn-primary btn-sm">
            + Create table
          </button>
        )}
      </header>

      <section className="flex flex-wrap items-center gap-3">
        <FilterBar label="Status" options={STATUS_FILTERS} value={statusFilter} onChange={setStatus} />
        <FilterBar
          label="Game"
          options={[{ value: '', label: 'All' }, ...GAME_OPTIONS.map(g => ({ value: g.id, label: g.label }))]}
          value={gameFilter}
          onChange={setGame}
        />
      </section>

      {error && (
        <p className="rounded-lg px-3 py-2 text-sm"
           style={{ background: 'var(--color-red-50)', color: 'var(--color-red-700)' }}>
          {error}
        </p>
      )}

      {tables === null ? (
        <LoadingGrid />
      ) : tables.length === 0 ? (
        <EmptyState canCreate={isSignedIn} onCreate={() => setShowCreate(true)} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {tables.map(table => (
            <li key={table.id}>
              <TableCard table={table} />
            </li>
          ))}
        </ul>
      )}

      {showCreate && (
        <CreateTableModal
          onClose={() => setShowCreate(false)}
          onCreated={table => {
            setShowCreate(false)
            // Optimistic prepend so the newly-created table appears immediately
            // — the next poll / real-time event will reconcile.
            setTables(curr => curr ? [table, ...curr] : [table])
          }}
        />
      )}
    </div>
  )
}

// ── Components ────────────────────────────────────────────────────────────────

function FilterBar({ label, options, value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</span>
      {options.map(opt => {
        const active = value === opt.value
        return (
          <button
            key={opt.value || '_all'}
            onClick={() => onChange(opt.value)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors"
            style={{
              backgroundColor: active ? 'var(--color-primary)' : 'var(--bg-surface)',
              color:           active ? 'white'                 : 'var(--text-secondary)',
              borderColor:     active ? 'var(--color-primary)' : 'var(--border-default)',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function TableCard({ table }) {
  const meta    = STATUS_META[table.status] ?? STATUS_META.COMPLETED
  const seated  = countSeated(table.seats)
  const max     = table.maxPlayers
  return (
    <Link
      to={`/tables/${table.id}`}
      className="block card p-4 no-underline transition-colors hover:bg-[var(--bg-surface-hover)]"
      style={{ color: 'var(--text-primary)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold truncate" style={{ fontFamily: 'var(--font-display)' }}>
            {gameLabel(table.gameId)}
          </p>
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
            {seated} / {max} seated{table.isTournament ? ' · Tournament' : ''}
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
          style={{ background: meta.bg, color: meta.color }}
        >
          {meta.label}
        </span>
      </div>

      {/* Seat strip — one dot per seat, filled = occupied */}
      <div className="flex items-center gap-1 mt-3">
        {Array.from({ length: max }).map((_, i) => {
          const filled = table.seats?.[i]?.status === 'occupied'
          return (
            <span
              key={i}
              className="w-3 h-3 rounded-full"
              style={{
                background:   filled ? 'var(--color-teal-500)' : 'transparent',
                border: `1.5px solid ${filled ? 'var(--color-teal-500)' : 'var(--border-default)'}`,
              }}
              aria-label={filled ? 'occupied seat' : 'empty seat'}
            />
          )
        })}
      </div>
    </Link>
  )
}

function LoadingGrid() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i}>
          <div className="card p-4 h-24" style={{ background: 'var(--bg-surface-hover)', opacity: 0.6 }} />
        </li>
      ))}
    </ul>
  )
}

function EmptyState({ canCreate, onCreate }) {
  return (
    <div className="rounded-2xl p-10 text-center"
         style={{ background: 'var(--bg-surface)', border: '1px dashed var(--border-default)' }}>
      <p className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
        No tables open right now
      </p>
      <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
        {canCreate
          ? 'Be the first — start a new table and invite someone to play.'
          : 'Sign in to create the first table.'}
      </p>
      {canCreate && (
        <button onClick={onCreate} className="btn btn-primary btn-sm mt-4">
          Create table
        </button>
      )}
    </div>
  )
}

function CreateTableModal({ onClose, onCreated }) {
  const navigate = useNavigate()
  const [gameId,    setGameId]    = useState(GAME_OPTIONS[0].id)
  const [isPrivate, setIsPrivate] = useState(false)
  const [busy,      setBusy]      = useState(false)
  const [err,       setErr]       = useState(null)

  const game = useMemo(() => GAME_OPTIONS.find(g => g.id === gameId) ?? GAME_OPTIONS[0], [gameId])

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const token = await getToken()
      if (!token) throw new Error('Sign in to create a table.')
      const { table } = await api.tables.create({
        gameId,
        minPlayers: game.minPlayers,
        maxPlayers: game.maxPlayers,
        isPrivate,
      }, token)
      onCreated(table)
      navigate(`/tables/${table.id}`)
    } catch (e2) {
      setErr(e2.message || 'Create failed')
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl p-5 space-y-4"
        style={{ background: 'var(--bg-surface)', boxShadow: 'var(--shadow-md)' }}
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>Create table</h2>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
        </header>

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Game</span>
          <select
            value={gameId}
            onChange={e => setGameId(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          >
            {GAME_OPTIONS.map(g => (
              <option key={g.id} value={g.id}>{g.label}</option>
            ))}
          </select>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={e => setIsPrivate(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-semibold">Private</span>
            <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
              Not listed publicly. Share the direct link with anyone you want to join.
            </span>
          </span>
        </label>

        {err && (
          <p className="rounded-lg px-3 py-2 text-sm"
             style={{ background: 'var(--color-red-50)', color: 'var(--color-red-700)' }}>
            {err}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
                  className="btn btn-ghost btn-sm">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn btn-primary btn-sm">
            {busy ? 'Creating…' : 'Create table'}
          </button>
        </div>
      </form>
    </div>
  )
}
