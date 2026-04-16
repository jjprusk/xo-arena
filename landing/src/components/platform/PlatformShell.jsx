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
 * Rendering-mode semantics:
 *   focused         → full viewport, platform chrome hidden, only the game
 *                      and a minimal escape affordance are visible. The
 *                      natural default when a seated player is in an
 *                      ACTIVE/PLAYING state — see selectDefaultMode.
 *   chrome-present  → game sits at its preferred width with a sidebar
 *                      alongside that surfaces table context + tabs.
 *
 * The shell is agnostic about where its data comes from. Today it's
 * used by PlayPage (with a session from useGameSDK). Phase 3.4 will
 * use it from TableDetailPage too, once Tables become the source of
 * truth for live game sessions.
 */

import React, { Suspense, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'

// ── Constants ─────────────────────────────────────────────────────────────────

const WIDTH_CLASS = {
  compact:    'max-w-sm',
  standard:   'max-w-md',
  wide:       'max-w-2xl',
  fullscreen: 'max-w-full',
}

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
 * Choose the default rendering mode based on the session snapshot.
 * - Seated players with an active/playing game → focused (maximize board)
 * - Everyone else (spectators, idle, waiting)   → chrome-present
 *
 * Exported so callers can override via the `initialMode` prop without
 * re-implementing the heuristic.
 */
export function selectDefaultMode({ isSpectator, phase }) {
  if (isSpectator) return 'chrome-present'
  if (phase === 'playing') return 'focused'
  return 'chrome-present'
}

// ── Public shell ──────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {object}     props.gameMeta       GameMeta from the loaded game module
 * @param {object}     [props.session]      GameSession (for mode defaulting)
 * @param {string}     [props.phase]        'connecting' | 'waiting' | 'playing' | 'finished'
 * @param {object}     [props.table]        Table row (optional; enables sidebar)
 * @param {number}     [props.spectatorCount]
 * @param {'focused'|'chrome-present'} [props.initialMode]
 * @param {string|null}[props.backHref]     where the escape affordance links to
 * @param {() => void} [props.onLeave]      if provided, shows a Leave button in the sidebar
 * @param {ReactNode}  props.children       the game component
 */
export default function PlatformShell({
  gameMeta,
  session,
  phase,
  table,
  spectatorCount = 0,
  initialMode,
  backHref = '/',
  onLeave,
  children,
}) {
  const defaultMode = useMemo(
    () => initialMode ?? selectDefaultMode({
      isSpectator: !!session?.isSpectator,
      phase,
    }),
    [initialMode, session?.isSpectator, phase],
  )
  const [mode, setMode] = useState(defaultMode)

  const widthClass = WIDTH_CLASS[gameMeta?.layout?.preferredWidth ?? 'standard'] ?? 'max-w-md'
  const themeStyle = useMemo(() => {
    if (typeof document === 'undefined') return resolveThemeVars(gameMeta?.theme, false)
    return resolveThemeVars(gameMeta?.theme, document.documentElement.classList.contains('dark'))
  }, [gameMeta?.theme])

  if (mode === 'focused') {
    return (
      <FocusedFrame themeStyle={themeStyle} widthClass={widthClass}
                    onExpand={() => setMode('chrome-present')}
                    backHref={backHref}>
        {children}
      </FocusedFrame>
    )
  }

  return (
    <ChromePresentFrame
      gameMeta={gameMeta}
      session={session}
      phase={phase}
      table={table}
      spectatorCount={spectatorCount}
      themeStyle={themeStyle}
      widthClass={widthClass}
      onFocus={() => setMode('focused')}
      onLeave={onLeave}
    >
      {children}
    </ChromePresentFrame>
  )
}

// ── Focused frame ─────────────────────────────────────────────────────────────

function FocusedFrame({ children, themeStyle, widthClass, onExpand, backHref }) {
  return (
    <div
      className={`relative mx-auto w-full ${widthClass} flex flex-col items-center py-6 px-4`}
      style={themeStyle}
      data-shell-mode="focused"
    >
      {/* Affordance chrome: semi-transparent so it doesn't compete with the
          board, but high-enough opacity + a surface background that the
          buttons are unambiguously discoverable against busy page backgrounds
          (Colosseum). Previous 30% opacity on muted text was effectively
          invisible. */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-1 pt-1 pointer-events-none">
        <Link
          to={backHref}
          className="pointer-events-auto flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-opacity opacity-70 hover:opacity-100"
          style={{
            color: 'var(--text-secondary)',
            background: 'var(--bg-surface)',
            boxShadow: 'var(--shadow-card)',
          }}
          title="Back"
        >
          ← Back
        </Link>
        <button
          onClick={onExpand}
          className="pointer-events-auto text-xs px-2 py-1 rounded-lg transition-opacity opacity-70 hover:opacity-100"
          style={{
            color: 'var(--text-secondary)',
            background: 'var(--bg-surface)',
            boxShadow: 'var(--shadow-card)',
          }}
          title="Show table context"
          aria-label="Show table context"
        >
          ⤢
        </button>
      </div>
      <Suspense fallback={<ShellSpinner />}>
        {children}
      </Suspense>
    </div>
  )
}

// ── Chrome-present frame ──────────────────────────────────────────────────────

function ChromePresentFrame({
  children, gameMeta, session, phase, table, spectatorCount,
  themeStyle, widthClass, onFocus, onLeave,
}) {
  return (
    <div className="max-w-5xl mx-auto w-full px-4 py-6" data-shell-mode="chrome-present">
      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        {/* Game column */}
        <div
          className={`relative ${widthClass} mx-auto w-full flex flex-col items-center`}
          style={themeStyle}
        >
          <button
            onClick={onFocus}
            className="absolute top-0 right-0 text-xs px-2 py-1 rounded-lg transition-opacity opacity-70 hover:opacity-100 z-10"
            style={{
              color: 'var(--text-secondary)',
              background: 'var(--bg-surface)',
              boxShadow: 'var(--shadow-card)',
            }}
            title="Focus mode (hide chrome)"
            aria-label="Focus mode"
          >
            ⤡
          </button>
          <Suspense fallback={<ShellSpinner />}>
            {children}
          </Suspense>
        </div>

        {/* Context sidebar */}
        <TableContextSidebar
          gameMeta={gameMeta}
          session={session}
          phase={phase}
          table={table}
          spectatorCount={spectatorCount}
          onLeave={onLeave}
        />
      </div>
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function TableContextSidebar({ gameMeta, session, phase, table, spectatorCount, onLeave }) {
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
