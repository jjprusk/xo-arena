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

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { getToken } from '../lib/getToken.js'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { useEventStream } from '../lib/useEventStream.js'
import { ListTable, ListTh, ListTd, ListTr, ListPagination, SearchBar } from '../components/ui/ListTable.jsx'
import ShareTableButton from '../components/tables/ShareTableButton.jsx'
import { BoardPreview as XoBoardPreview } from '@callidity/game-xo'
import { GAMES } from '../lib/gameRegistry.js'

// Map game IDs to their preview component. Add new games here as they ship.
const GAME_PREVIEWS = { xo: XoBoardPreview }

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'FORMING',   label: 'Forming'    },
  { value: 'ACTIVE',    label: 'In play'    },
  { value: 'COMPLETED', label: 'Completed'  },
]

// Forming + In play matches the intuitive "what can I join right now" default.
const DEFAULT_STATUS_SELECTION = ['FORMING', 'ACTIVE']

const STATUS_META = {
  FORMING:   { label: 'Forming',    color: 'var(--color-amber-600)', bg: 'rgba(217, 119, 6, 0.08)' },
  ACTIVE:    { label: 'In play',    color: 'var(--color-teal-600)',  bg: 'rgba(13, 148, 136, 0.08)' },
  COMPLETED: { label: 'Completed',  color: 'var(--color-slate-500)', bg: 'rgba(100, 116, 139, 0.08)' },
}

// Games available to create a table for. Sourced from the shared registry.
const GAME_OPTIONS = GAMES

// Date presets. Values are the key into `dateRangeSince()` below.
const DATE_OPTIONS = [
  { value: 'all',   label: 'All time'     },
  { value: 'today', label: 'Today'        },
  { value: 'week',  label: 'This week'    },
  { value: 'month', label: 'Last 30 days' },
]

function dateRangeSince(key) {
  const now = new Date()
  if (key === 'today') {
    const d = new Date(now); d.setHours(0, 0, 0, 0); return d.toISOString()
  }
  if (key === 'week') {
    const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString()
  }
  if (key === 'month') {
    const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString()
  }
  return null
}

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

  // Filter state lives in the URL so the browser Back button restores it
  // after visiting a table detail page. replace:true on every filter update
  // keeps the history stack clean (one /tables entry, not one per keypress).
  const [searchParams, setSearchParams] = useSearchParams()

  const statusSel = useMemo(() => {
    const raw = searchParams.get('status')
    if (raw === null)  return DEFAULT_STATUS_SELECTION  // absent = default
    if (raw === 'ALL') return []                         // explicit all
    return raw.split(',').filter(v => STATUS_OPTIONS.some(o => o.value === v))
  }, [searchParams])

  const dateRange  = searchParams.get('date') ?? 'today'
  const gameFilter = searchParams.get('game') ?? ''
  const searchTerm = searchParams.get('q')    ?? ''
  const page       = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))

  // Local input state for the search box; debounced writes land in the URL.
  const [searchInput, setSearchInput] = useState(searchTerm)

  const [tables,     setTables]     = useState(null)
  const [total,      setTotal]      = useState(0)
  const [error,      setError]      = useState(null)
  const [showCreate, setShowCreate] = useState(false)

  const LIMIT = 20
  const totalPages = Math.max(1, Math.ceil(total / LIMIT))

  function updateParams(updates, replace = true) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === undefined) next.delete(k)
        else next.set(k, String(v))
      }
      return next
    }, { replace })
  }

  const setStatusSel = (val) => {
    // Always write status to URL so the selection is always visible there.
    // All ([]) uses the 'ALL' sentinel so it survives the round-trip.
    const raw = val.length === 0 ? 'ALL' : val.join(',')
    updateParams({ status: raw, page: null })
  }
  const setDateRange = (val) => updateParams({ date: val === 'today' ? null : val, page: null })
  const setGame      = (val) => updateParams({ game: val || null, page: null })
  const setPage      = (n)   => updateParams({ page: n === 1 ? null : n }, false)

  // Debounce search input → URL (null removes the param when box is cleared).
  useEffect(() => {
    const t = setTimeout(() => {
      updateParams({ q: searchInput.trim() || null, page: null })
    }, 250)
    return () => clearTimeout(t)
  }, [searchInput]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchTables = useCallback(async () => {
    try {
      const token = await getToken().catch(() => null)
      const opts = { limit: LIMIT, page }
      if (statusSel.length > 0) opts.status = statusSel.join(',')
      if (gameFilter)           opts.gameId = gameFilter
      if (searchTerm)           opts.search = searchTerm
      const since = dateRangeSince(dateRange)
      if (since) opts.since = since
      const res = await api.tables.list(opts, token)
      setTables(res.tables ?? [])
      setTotal(res.total ?? 0)
      setError(null)
    } catch (err) {
      setError(err.message || 'Failed to load tables')
    }
  }, [statusSel, gameFilter, dateRange, searchTerm, page])

  useEffect(() => { fetchTables() }, [fetchTables])

  // Real-time: listen to table.* bus events via SSE and refresh the list.
  // Small events stream, so a full re-fetch is simpler and correct vs.
  // reconciling individual mutations. Coalesces bursts into a single fetch
  // via a short debounce.
  const debounceRef = useRef(null)
  const TABLE_EVENT_TYPES = new Set([
    'table.created', 'player.joined', 'player.left',
    'spectator.joined', 'table.empty', 'table.completed', 'table.deleted',
  ])
  useEventStream({
    channels: ['guide:notification'],
    onEvent: (_channel, payload) => {
      if (!TABLE_EVENT_TYPES.has(payload?.type)) return
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => { fetchTables() }, 250)
    },
  })
  useEffect(() => () => clearTimeout(debounceRef.current), [])

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

      <section className="space-y-3">
        <SearchBar
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Search by player name…"
          className="w-full"
        />
        <div className="flex flex-wrap items-center gap-2">
          <StatusSegmented options={STATUS_OPTIONS} value={statusSel} onChange={setStatusSel} />
          <FilterSelect
            options={DATE_OPTIONS}
            value={dateRange}
            onChange={setDateRange}
            aria-label="Created"
          />
          {GAME_OPTIONS.length > 1 && (
            <FilterSelect
              options={[{ value: '', label: 'All games' }, ...GAME_OPTIONS.map(g => ({ value: g.id, label: g.label }))]}
              value={gameFilter}
              onChange={setGame}
              aria-label="Game"
            />
          )}
        </div>
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
        <>
          <TablesList tables={tables} />
          <ListPagination
            page={page}
            totalPages={totalPages}
            total={total}
            limit={LIMIT}
            onPageChange={setPage}
            noun="tables"
          />
        </>
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

/**
 * Segmented status control with an explicit All chip.
 *
 * Model: `value` is an array of selected status strings. `[]` means All (and
 * we show the All chip as lit, every other chip dimmed).
 *
 * Interaction:
 *  - Clicking All clears the selection (→ `[]`).
 *  - Clicking a status chip while All is active starts a fresh single-chip
 *    selection (so the user can switch cleanly from "everything" to "just
 *    this one" without an extra click).
 *  - Otherwise clicking a status chip toggles it in/out of the set.
 *  - Emptying the set (removing the last chip) snaps back to All instead of
 *    leaving zero results.
 *
 * Sizing is deliberately tight (px-2.5, text-[11px]) so the four chips fit
 * alongside the Created dropdown on a ~360px phone without wrapping inside
 * the pill.
 */
function StatusSegmented({ options, value, onChange }) {
  const allActive = value.length === 0
  const btn = (active, isFirst) => ({
    className: 'px-2.5 py-1.5 text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap',
    style: {
      backgroundColor: active ? 'var(--color-primary)' : 'transparent',
      color:           active ? 'white'                 : 'var(--text-secondary)',
      borderLeft:      isFirst ? 'none' : '1px solid var(--border-default)',
    },
  })
  return (
    <div
      className="inline-flex rounded-full border overflow-hidden"
      style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}
      role="group"
      aria-label="Status"
    >
      <button
        {...btn(allActive, true)}
        onClick={() => onChange([])}
        aria-pressed={allActive}
      >
        All
      </button>
      {options.map(opt => {
        const active = value.includes(opt.value)
        return (
          <button
            key={opt.value}
            {...btn(active, false)}
            onClick={() => {
              if (allActive) { onChange([opt.value]); return }
              const next = active
                ? value.filter(v => v !== opt.value)
                : [...value, opt.value]
              // Selecting every status is equivalent to All — collapse so the
              // All chip lights up and the individual chips go quiet.
              if (next.length === options.length) { onChange([]); return }
              onChange(next)  // empty next is fine — it reads as All on next render
            }}
            aria-pressed={active}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Compact native select styled to match the pill aesthetic. Using <select>
 * gives us free keyboard + touch behavior (iOS wheel, Android bottom sheet)
 * without needing a custom dropdown widget.
 */
function FilterSelect({ options, value, onChange, ...rest }) {
  return (
    <div className="relative inline-flex">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none pl-3.5 pr-8 py-1.5 rounded-full border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-colors"
        style={{
          background:  'var(--bg-surface)',
          borderColor: 'var(--border-default)',
          color:       'var(--text-primary)',
        }}
        {...rest}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"
        width="10" height="10" viewBox="0 0 10 10" fill="none"
        style={{ color: 'var(--text-muted)' }}
      >
        <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/**
 * Virtualization-friendly list view. Scales to hundreds of tables because the
 * ListTable container has a fixed viewport-fit height with its own overflow
 * scroller — the page itself doesn't grow. Each row is a clickable link via
 * ListTr's onClick navigation.
 */
function TablesList({ tables }) {
  const navigate = useNavigate()
  return (
    <ListTable
      fitViewport
      bottomPadding={96}
      columns={['24%', '12%', '14%', '14%', '24%', '56px']}
    >
      <thead>
        <tr>
          <ListTh>Game</ListTh>
          <ListTh>Status</ListTh>
          <ListTh align="center">Seats</ListTh>
          <ListTh align="center">Type</ListTh>
          <ListTh>Seat strip</ListTh>
          <ListTh align="center"><span className="sr-only">Share</span></ListTh>
        </tr>
      </thead>
      <tbody>
        {tables.map((table, i) => (
          <TableRow
            key={table.id}
            table={table}
            last={i === tables.length - 1}
            onClick={() => navigate(`/tables/${table.id}`)}
          />
        ))}
      </tbody>
    </ListTable>
  )
}

function TableRow({ table, last, onClick }) {
  const meta    = STATUS_META[table.status] ?? STATUS_META.COMPLETED
  const seated  = countSeated(table.seats)
  const max     = table.maxPlayers
  const Preview = table.status === 'ACTIVE' ? (GAME_PREVIEWS[table.gameId] ?? null) : null
  return (
    <ListTr last={last} onClick={onClick}>
      <ListTd>
        <div className="flex items-center gap-2 min-w-0">
          {Preview && (
            <Preview previewState={table.previewState} size={36} />
          )}
          <span
            className="font-semibold truncate"
            style={{ color: 'var(--text-primary)' }}
            title={gameLabel(table.gameId)}
          >
            {gameLabel(table.gameId)}
          </span>
        </div>
      </ListTd>
      <ListTd>
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
          style={{ background: meta.bg, color: meta.color }}
        >
          {meta.label}
        </span>
      </ListTd>
      <ListTd align="center">
        <span className="tabular-nums">{seated} / {max}</span>
      </ListTd>
      <ListTd align="center">
        <span
          className="text-xs block truncate"
          style={{ color: 'var(--text-muted)' }}
          title={table.isTournament ? 'Tournament' : table.isPrivate ? 'Private' : 'Public'}
        >
          {table.isTournament ? 'Tournament' : table.isPrivate ? 'Private' : 'Public'}
        </span>
      </ListTd>
      <ListTd>
        <div className="flex items-center gap-1">
          {Array.from({ length: max }).map((_, i) => {
            const filled = table.seats?.[i]?.status === 'occupied'
            return (
              <span
                key={i}
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{
                  background:   filled ? 'var(--color-teal-500)' : 'transparent',
                  border: `1.5px solid ${filled ? 'var(--color-teal-500)' : 'var(--border-default)'}`,
                }}
                aria-label={filled ? 'occupied seat' : 'empty seat'}
              />
            )
          })}
        </div>
      </ListTd>
      <ListTd align="center">
        {/* Share button — stops propagation so the row click doesn't navigate */}
        <ShareTableButton tableId={table.id} variant="icon" />
      </ListTd>
    </ListTr>
  )
}

function LoadingGrid() {
  // Minimal centered spinner. The previous placeholder-grid "skeleton" looked
  // like a matrix of shadows that flashed briefly on every filter change —
  // distracting for a list page where the payload is small and the fetch is
  // typically < 200ms. A single spinner is quieter.
  return (
    <div className="flex items-center justify-center py-12" aria-busy="true" aria-label="Loading tables">
      <div
        className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}
      />
    </div>
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
  const [gameId,     setGameId]     = useState(GAME_OPTIONS[0].id)
  const [isPrivate,  setIsPrivate]  = useState(false)
  const [opponentId, setOpponentId] = useState('human')  // 'human' | bot domain User.id
  const [myBots,     setMyBots]     = useState([])
  const [busy,       setBusy]       = useState(false)
  const [err,        setErr]        = useState(null)

  const game = useMemo(() => GAME_OPTIONS.find(g => g.id === gameId) ?? GAME_OPTIONS[0], [gameId])

  // Fetch the user's own bots to populate the opponent dropdown
  useEffect(() => {
    getToken().then(token => {
      if (!token) return
      api.bots.mine(token).then(res => setMyBots(res.bots ?? [])).catch(() => {})
    })
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      if (opponentId !== 'human') {
        const bot = myBots.find(b => b.id === opponentId)
        if (!bot) throw new Error('Bot not found')
        const qs = new URLSearchParams({ botUserId: bot.id })
        if (bot.botModelId) qs.set('botSkillId', bot.botModelId)
        navigate(`/play?${qs}`)
        onClose()
        return
      }
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

  const hasBots = myBots.length > 0

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

        {hasBots && (
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Opponent</span>
            <select
              value={opponentId}
              onChange={e => setOpponentId(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
            >
              <option value="human">Human (open seat)</option>
              {myBots.map(b => (
                <option key={b.id} value={b.id}>{b.displayName}</option>
              ))}
            </select>
          </label>
        )}

        {opponentId === 'human' && (
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
        )}

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
