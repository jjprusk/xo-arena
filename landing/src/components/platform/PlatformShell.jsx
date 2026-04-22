// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * PlatformShell — the chrome around any registered game.
 *
 * Phase 3.3. Wraps a game's React component and provides:
 *   • focused vs chrome-present rendering mode (auto-detected + togglable)
 *   • game-theme CSS variables (from meta.theme)
 *   • game-width container class (from meta.layout.preferredWidth)
 *   • escape affordance (always visible in focused mode, also in chrome-
 *     present top-left if no back-nav context is otherwise rendered)
 *   • table context sidebar (chrome-present only) — game info, seats,
 *     spectator count, optional "Leave" button
 *   • game-specific tabs (Gym / Puzzles) driven off meta.supportsTraining
 *     and meta.supportsPuzzles — links route to /gym and /puzzles on landing
 *
 * Layout:
 *   The table surface (seat pods, surface background, outcome banner) is
 *   always visible — players sit at the table for the duration of the session.
 *   The info sidebar (game title, status, Gym/Puzzles links, Leave button) is
 *   toggleable via a ▣/◫ button so players can focus on the board without
 *   leaving the table.
 *
 * The shell is agnostic about where its data comes from. Today it's
 * used by PlayPage (with a session from useGameSDK). Phase 3.4 will
 * use it from TableDetailPage too, once Tables become the source of
 * truth for live game sessions.
 */

import React, { Suspense, useState, useMemo, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_META = {
  FORMING:   { label: 'Forming',    color: 'var(--color-amber-600)' },
  ACTIVE:    { label: 'In play',    color: 'var(--color-teal-600)'  },
  COMPLETED: { label: 'Completed',  color: 'var(--color-slate-500)' },
}

// ── Theme helper ──────────────────────────────────────────────────────────────

/**
 * Merge base theme tokens with mode-specific overrides into a single style
 * object the shell applies as inline CSS variables. Returns undefined when
 * the game has no theme — callers should treat undefined as "no scoped
 * overrides; inherit from platform defaults".
 */
export function resolveThemeVars(theme, isDark) {
  if (!theme) return undefined
  return { ...theme.tokens, ...(isDark ? theme.dark : theme.light) }
}

// ── Default-mode selection ────────────────────────────────────────────────────

/**
 * Legacy helper — kept for backward compat with existing callers.
 * The 'focused' mode has been removed; the table surface is always rendered.
 * Sidebar visibility is now a toggle, defaulting to shown.
 */
export function selectDefaultMode({ isSpectator: _s, phase: _p }) {
  return 'chrome-present'
}

// ── Public shell ──────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {object}     props.gameMeta       GameMeta from the loaded game module
 * @param {object}     [props.session]      GameSession (for mode defaulting)
 * @param {string}     [props.phase]        'connecting' | 'waiting' | 'playing' | 'finished'
 * @param {object}     [props.gameState]    { currentTurn, winner, isDraw } from onMove
 * @param {object}     [props.table]        Table row (optional; enables sidebar)
 * @param {number}     [props.spectatorCount]
 * @param {string}     [props.tournamentId]
 * @param {'focused'|'chrome-present'} [props.initialMode]  'focused' → sidebar hidden initially
 * @param {string|null}[props.backHref]     where the escape affordance links to
 * @param {() => void} [props.onLeave]      if provided, shows a Leave button in the sidebar
 * @param {ReactNode}  props.children       the game component
 */
export default function PlatformShell({
  gameMeta,
  session,
  phase,
  gameState,
  table,
  spectatorCount = 0,
  tournamentId,
  initialMode,
  backHref = '/',
  onLeave,
  children,
}) {
  // On mobile (< 768px), sidebar starts hidden when already playing (e.g. reconnect).
  // initialMode='focused' also starts hidden (backward compat).
  const [showSidebar, setShowSidebar] = useState(() => {
    if (initialMode === 'focused') return false
    if (typeof window !== 'undefined' && window.innerWidth < 768 && phase === 'playing') return false
    return true
  })

  // Auto-hide sidebar on mobile when game transitions from waiting → playing
  const _prevPhaseRef = useRef(phase)
  useEffect(() => {
    if (_prevPhaseRef.current !== 'playing' && phase === 'playing' && window.innerWidth < 768) {
      setShowSidebar(false)
    }
    _prevPhaseRef.current = phase
  }, [phase])

  const themeStyle = useMemo(() => {
    if (typeof document === 'undefined') return resolveThemeVars(gameMeta?.theme, false)
    return resolveThemeVars(gameMeta?.theme, document.documentElement.classList.contains('dark'))
  }, [gameMeta?.theme])

  return (
    <GameFrame
      gameMeta={gameMeta}
      session={session}
      phase={phase}
      gameState={gameState}
      table={table}
      spectatorCount={spectatorCount}
      tournamentId={tournamentId}
      themeStyle={themeStyle}
      backHref={backHref}
      showSidebar={showSidebar}
      onToggleSidebar={() => setShowSidebar(v => !v)}
      onLeave={onLeave}
    >
      {children}
    </GameFrame>
  )
}

// ── Game frame ────────────────────────────────────────────────────────────────

function GameFrame({
  children, gameMeta, session, phase, gameState, table, spectatorCount,
  tournamentId, themeStyle, backHref, showSidebar, onToggleSidebar, onLeave,
}) {
  const controlStyle = {
    color: 'var(--text-secondary)',
    background: 'var(--bg-surface)',
    boxShadow: 'var(--shadow-card)',
  }
  return (
    <div className="max-w-5xl mx-auto w-full px-4 py-6" data-shell-mode="chrome-present">
      <div className={`grid gap-4 items-start${showSidebar ? ' md:grid-cols-[1fr_260px]' : ''}`}>
        {/* Game column */}
        <div className="w-full flex flex-col items-center" style={themeStyle}>
          {/* Control bar: ← Back on left, sidebar toggle on right */}
          <div className="w-full max-w-[440px] flex items-center justify-between mb-2 px-1">
            <Link
              to={backHref}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg opacity-70 hover:opacity-100 transition-opacity"
              style={controlStyle}
            >
              ← Back
            </Link>
            <button
              onClick={onToggleSidebar}
              className="text-xs px-2 py-1 rounded-lg opacity-70 hover:opacity-100 transition-opacity"
              style={controlStyle}
              title={showSidebar ? 'Hide info panel' : 'Show info panel'}
              aria-label={showSidebar ? 'Hide info panel' : 'Show info panel'}
            >
              {showSidebar ? '◫' : '▣'}
            </button>
          </div>
          <TableSurface
            phase={phase}
            session={session}
            gameState={gameState}
            spectatorCount={spectatorCount}
          >
            <Suspense fallback={<ShellSpinner />}>
              {children}
            </Suspense>
          </TableSurface>
        </div>

        {/* Info sidebar — toggleable */}
        {showSidebar && (
          <TableContextSidebar
            gameMeta={gameMeta}
            session={session}
            phase={phase}
            table={table}
            spectatorCount={spectatorCount}
            tournamentId={tournamentId}
            onLeave={onLeave}
          />
        )}
      </div>
    </div>
  )
}

// ── Table surface ─────────────────────────────────────────────────────────────

function getSeatState(player, session, gameState, phase) {
  if (!player || phase === 'waiting') return 'idle'
  const mark = session?.settings?.marks?.[player.id]
  if (phase === 'playing') {
    if (!mark || !gameState?.currentTurn) return 'idle'
    return mark === gameState.currentTurn ? 'turn' : 'idle'
  }
  if (phase === 'finished') {
    if (gameState?.isDraw || !gameState?.winner) return 'idle'
    return mark === gameState.winner ? 'winner' : 'loser'
  }
  return 'idle'
}

function TableSurface({ phase, session, gameState, spectatorCount, children }) {
  const prevPhaseRef = useRef(phase)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (prevPhaseRef.current === 'waiting' && phase === 'playing') {
      setStarting(true)
      const t = setTimeout(() => setStarting(false), 800)
      prevPhaseRef.current = phase
      return () => clearTimeout(t)
    }
    prevPhaseRef.current = phase
  }, [phase])

  const players       = session?.players ?? []
  const currentUserId = session?.currentUserId
  const isSpectator   = session?.isSpectator

  // Relative POV: you at bottom, opponent at top.
  // For spectators: seat 0 bottom, seat 1 top (canonical).
  const bottomPlayer = isSpectator || !currentUserId
    ? (players[0] ?? null)
    : (players.find(p => p.id === currentUserId) ?? null)
  const topPlayer = isSpectator || !currentUserId
    ? (players[1] ?? null)
    : (players.find(p => p.id !== currentUserId) ?? null)

  // Outcome banner
  let outcomeLabel = null, outcomeVariant = null
  if (phase === 'finished' && gameState) {
    if (gameState.isDraw) {
      outcomeLabel = 'Draw'; outcomeVariant = 'draw'
    } else if (gameState.winner) {
      if (isSpectator) {
        const winnerPlayer = players.find(
          p => session?.settings?.marks?.[p.id] === gameState.winner
        )
        outcomeLabel = winnerPlayer ? `${winnerPlayer.displayName} wins` : 'Win'
        outcomeVariant = 'win'
      } else {
        const myMark = session?.settings?.myMark
          ?? session?.settings?.marks?.[currentUserId]
        if (gameState.winner === myMark) {
          outcomeLabel = 'You Win'; outcomeVariant = 'win'
        } else {
          outcomeLabel = 'You Lose'; outcomeVariant = 'lose'
        }
      }
    }
  }

  const archetype = 'table-2p' // sit-down 2p — extend per meta.tableArchetype later

  return (
    <div className={`table-container ${archetype}`}>
      {/* Table surface first so both seat pods (rendered after) paint on top */}
      <div className={`table-surface${starting ? ' table-starting' : ''}`}>
        {spectatorCount > 0 && <SpectatorBadge count={spectatorCount} />}
        <div className="table-center">
          {phase === 'waiting'
            ? <FormingPanel session={session} />
            : children
          }
        </div>
        {outcomeLabel && (
          <OutcomeBanner label={outcomeLabel} variant={outcomeVariant} />
        )}
      </div>

      {topPlayer && (
        <SeatPod
          player={topPlayer}
          position="top"
          state={getSeatState(topPlayer, session, gameState, phase)}
          isYou={!isSpectator && topPlayer.id === currentUserId}
        />
      )}
      {bottomPlayer && (
        <SeatPod
          player={bottomPlayer}
          position="bottom"
          state={getSeatState(bottomPlayer, session, gameState, phase)}
          isYou={!isSpectator && bottomPlayer.id === currentUserId}
        />
      )}
    </div>
  )
}

function SeatPod({ player, position, state, isYou }) {
  const initials = (player.displayName ?? '?')[0].toUpperCase()
  const stateClass = state === 'idle' ? '' : `seat--${state}`
  // Render the meta row ALWAYS — with an invisible spacer for non-bots — so
  // both pods have identical vertical structure. Without this, a Bot pod is
  // taller than a You pod by one row, and the top/bottom avatar translate
  // math goes asymmetric (top straddles the rim, bottom ends up mostly
  // inside). The extra row costs a few invisible pixels on the human side.
  return (
    <div className={['seat', `seat--${position}`, stateClass].filter(Boolean).join(' ')}>
      <div className={`seat__avatar${player.isBot ? ' seat__avatar--bot' : ''}`}>
        {initials}
      </div>
      <div className="seat__name">
        {isYou ? 'You' : (player.displayName ?? '—')}
      </div>
      <div className="seat__meta" aria-hidden={player.isBot ? undefined : 'true'}>
        {player.isBot
          ? <span className="seat__bot-tag">BOT</span>
          : <span className="seat__bot-tag" style={{ visibility: 'hidden' }}>BOT</span>}
      </div>
    </div>
  )
}

function SpectatorBadge({ count }) {
  return (
    <div className="spectator-badge" aria-label={`${count} watching`}>
      {count} watching
    </div>
  )
}

function OutcomeBanner({ label, variant }) {
  return (
    <div className={`outcome-banner outcome-banner--${variant}`} role="status">
      {label}
    </div>
  )
}

function FormingPanel({ session }) {
  const shareUrl = session?.tableId
    ? `${window.location.origin}/play?join=${session.tableId}`
    : null
  const copyUrl = () => shareUrl && navigator.clipboard?.writeText(shareUrl).catch(() => {})
  return (
    <div className="forming-panel">
      <p className="forming-panel__title">Waiting for opponent</p>
      <div className="forming-dots">
        <span /><span /><span />
      </div>
      {shareUrl && (
        <>
          <p className="forming-panel__hint">Share this link to invite someone</p>
          <button className="forming-panel__share" onClick={copyUrl} title="Copy invite link">
            📋 /play?join={session.tableId}
          </button>
        </>
      )}
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function TableContextSidebar({ gameMeta, session, phase, table, spectatorCount, tournamentId, onLeave }) {
  const status = table?.status ?? (phase === 'playing' ? 'ACTIVE' : phase === 'waiting' ? 'FORMING' : null)
  const meta = status ? STATUS_META[status] ?? null : null
  const players = session?.players ?? []

  return (
    <aside
      className="rounded-xl border p-4 space-y-4 self-start"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
      aria-label="Table context"
    >
      {/* Game header */}
      <div>
        <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Game</p>
        <p className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {gameMeta?.title ?? gameMeta?.id ?? 'Game'}
        </p>
      </div>

      {/* Status + counts */}
      {meta && (
        <div className="flex items-center justify-between gap-2">
          <span
            className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold"
            style={{ background: 'var(--bg-surface-hover)', color: meta.color }}
          >
            {meta.label}
          </span>
          {spectatorCount > 0 && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {spectatorCount} watching
            </span>
          )}
        </div>
      )}

      {/* Players */}
      {players.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
            Seated
          </p>
          <ul className="space-y-1">
            {players.map(p => (
              <li key={p.id} className="text-sm flex items-center gap-2">
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ background: 'var(--color-teal-600)' }}
                >
                  {(p.displayName ?? '?')[0].toUpperCase()}
                </span>
                <span className="truncate">{p.displayName ?? '—'}</span>
                {p.isBot && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--bg-surface-hover)', color: 'var(--text-muted)' }}>
                    BOT
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tournament card */}
      {tournamentId && (
        <div className="rounded-lg border px-3 py-2.5 space-y-1"
             style={{ background: 'var(--color-primary-light)', borderColor: 'rgba(74,111,165,0.2)' }}>
          <p className="text-xs font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            Tournament Match
          </p>
          <Link
            to={`/tournaments/${tournamentId}`}
            className="text-xs no-underline font-medium"
            style={{ color: 'var(--color-primary)' }}
          >
            Back to bracket →
          </Link>
        </div>
      )}

      {/* Game-specific tabs (meta flags) */}
      <GameTabs gameMeta={gameMeta} />

      {/* Leave / Back */}
      <div className="pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
        {onLeave ? (
          <button
            onClick={onLeave}
            className="w-full text-sm px-3 py-2 rounded-lg border transition-colors hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          >
            Leave table
          </button>
        ) : (
          <Link
            to="/tables"
            className="block w-full text-center text-sm px-3 py-2 rounded-lg border transition-colors hover:bg-[var(--bg-surface-hover)] no-underline"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          >
            Back to Tables
          </Link>
        )}
      </div>
    </aside>
  )
}

// ── Game-specific tabs ────────────────────────────────────────────────────────

/**
 * Render quick-access tabs for the game's supplementary surfaces: Gym (if the
 * game supports training) and Puzzles (if it ships a puzzle set). Driven off
 * meta flags so games opt-in declaratively — no central registry needed.
 */
function GameTabs({ gameMeta }) {
  const hasGym     = !!gameMeta?.supportsTraining
  const hasPuzzles = !!gameMeta?.supportsPuzzles
  if (!hasGym && !hasPuzzles) return null

  return (
    <div>
      <p className="text-xs uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
        More {gameMeta?.title ?? ''}
      </p>
      <div className="flex flex-col gap-1">
        {hasGym && (
          <Link
            to={`/gym?gameId=${encodeURIComponent(gameMeta.id)}`}
            className="text-sm px-3 py-2 rounded-lg border transition-colors hover:bg-[var(--bg-surface-hover)] no-underline"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          >
            ⚡ Gym — train a bot
          </Link>
        )}
        {hasPuzzles && (
          <Link
            to={`/puzzles?gameId=${encodeURIComponent(gameMeta.id)}`}
            className="text-sm px-3 py-2 rounded-lg border transition-colors hover:bg-[var(--bg-surface-hover)] no-underline"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          >
            ◈ Puzzles
          </Link>
        )}
      </div>
    </div>
  )
}

// ── Shared spinner ────────────────────────────────────────────────────────────

function ShellSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div
        className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}
      />
    </div>
  )
}
