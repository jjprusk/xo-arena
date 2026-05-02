import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PlatformShell, { selectDefaultMode, resolveThemeVars } from '../PlatformShell.jsx'

function wrap(children) {
  return render(<MemoryRouter>{children}</MemoryRouter>)
}

const xoMeta = {
  id: 'xo',
  title: 'XO',
  layout: { preferredWidth: 'compact' },
  theme:  { tokens: { '--game-mark-x': '#111' } },
  supportsTraining: true,
  supportsPuzzles:  true,
}

// ── selectDefaultMode ─────────────────────────────────────────────────────────

describe('selectDefaultMode', () => {
  it('always returns chrome-present — focused mode is removed', () => {
    expect(selectDefaultMode({ isSpectator: false, phase: 'playing'  })).toBe('chrome-present')
    expect(selectDefaultMode({ isSpectator: true,  phase: 'playing'  })).toBe('chrome-present')
    expect(selectDefaultMode({ isSpectator: false, phase: 'waiting'  })).toBe('chrome-present')
    expect(selectDefaultMode({ isSpectator: false, phase: 'finished' })).toBe('chrome-present')
  })
})

// ── resolveThemeVars ──────────────────────────────────────────────────────────

describe('resolveThemeVars', () => {
  it('returns undefined when no theme is provided', () => {
    expect(resolveThemeVars(undefined, false)).toBeUndefined()
  })
  it('merges base tokens with dark overrides when isDark=true', () => {
    const theme = {
      tokens: { '--game-mark-x': '#111', '--game-mark-o': '#222' },
      dark:   { '--game-mark-x': '#eee' },
      light:  { '--game-mark-x': '#000' },
    }
    expect(resolveThemeVars(theme, true)).toEqual({
      '--game-mark-x': '#eee',
      '--game-mark-o': '#222',
    })
  })
  it('merges base tokens with light overrides when isDark=false', () => {
    const theme = {
      tokens: { '--game-mark-x': '#111' },
      light:  { '--game-mark-x': '#000' },
    }
    expect(resolveThemeVars(theme, false)).toEqual({ '--game-mark-x': '#000' })
  })
})

// ── Sidebar toggle ────────────────────────────────────────────────────────────

describe('PlatformShell — sidebar toggle', () => {
  it('shows sidebar by default with ← Back link and toggle button', () => {
    wrap(
      <PlatformShell gameMeta={xoMeta} phase="playing" session={{ isSpectator: false }}>
        <div data-testid="game">BOARD</div>
      </PlatformShell>,
    )
    expect(screen.getByRole('complementary', { name: /table context/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /← back/i })).toBeInTheDocument()
  })

  it('honors initialMode="focused" → sidebar hidden initially', () => {
    wrap(
      <PlatformShell gameMeta={xoMeta} session={{ isSpectator: true }} initialMode="focused">
        <div data-testid="game">BOARD</div>
      </PlatformShell>,
    )
    expect(screen.queryByRole('complementary', { name: /table context/i })).toBeNull()
  })

  it('sidebar toggle button hides and re-shows the info panel', () => {
    wrap(
      <PlatformShell gameMeta={xoMeta} session={{ isSpectator: true }}>
        <div data-testid="game">BOARD</div>
      </PlatformShell>,
    )
    expect(screen.getByRole('complementary', { name: /table context/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /hide info panel/i }))
    expect(screen.queryByRole('complementary', { name: /table context/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /show info panel/i }))
    expect(screen.getByRole('complementary', { name: /table context/i })).toBeInTheDocument()
  })
})

// ── Sidebar content ───────────────────────────────────────────────────────────

describe('PlatformShell — sidebar content', () => {
  it('renders game title, status, players, and spectator count', () => {
    wrap(
      <PlatformShell
        gameMeta={xoMeta}
        phase="waiting"
        session={{
          isSpectator: false,
          players: [
            { id: 'u1', displayName: 'Alice', isBot: false },
            { id: 'u2', displayName: 'Bob-Bot', isBot: true },
          ],
        }}
        table={{ status: 'FORMING' }}
        spectatorCount={3}
      >
        <div data-testid="game">BOARD</div>
      </PlatformShell>,
    )
    const sidebar = screen.getByRole('complementary', { name: /table context/i })
    expect(sidebar).toHaveTextContent(/XO/)
    expect(sidebar).toHaveTextContent(/Forming/)
    expect(sidebar).toHaveTextContent(/3 watching/)
    expect(sidebar).toHaveTextContent(/Alice/)
    expect(sidebar).toHaveTextContent(/Bob-Bot/)
    expect(sidebar).toHaveTextContent(/BOT/)
  })

  // Demo tables (Hook step 2) include curated bot-vs-bot matchups where the
  // SAME bot plays both sides — e.g. "Sterling vs Sterling" for the high-tier
  // draw stalemate. Both seats arrive at PlatformShell with the same userId
  // (the bot's User row). Pre-fix, the seat list keyed by `p.id` and React
  // logged `Encountered two children with the same key 'cmn7…'` which broke
  // the watch-demo experience.
  it('renders both seats when two players share an id (bot-vs-self demo) — no duplicate-key warning', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    wrap(
      <PlatformShell
        gameMeta={xoMeta}
        phase="playing"
        session={{
          isSpectator: true,
          players: [
            { id: 'sterling', displayName: 'Sterling', isBot: true },
            { id: 'sterling', displayName: 'Sterling', isBot: true },
          ],
        }}
        table={{ status: 'ACTIVE' }}
      >
        <div data-testid="game">BOARD</div>
      </PlatformShell>,
    )
    // Scope to the sidebar seat list — the GameComponent under PlatformShell
    // also renders the bot names above/below the board.
    const sidebar = screen.getByRole('complementary', { name: /table context/i })
    const sidebarSterling = Array.from(sidebar.querySelectorAll('li')).filter(li =>
      /Sterling/.test(li.textContent ?? ''),
    )
    expect(sidebarSterling).toHaveLength(2)
    // No "same key" warning was emitted by React.
    const dupKeyCalls = warn.mock.calls.filter(args =>
      typeof args[0] === 'string' && args[0].includes('the same key'),
    )
    expect(dupKeyCalls).toEqual([])
    warn.mockRestore()
  })

  it('renders Gym and Puzzles tab links based on meta flags', () => {
    wrap(
      <PlatformShell gameMeta={xoMeta} session={{ isSpectator: true }}>
        <div>game</div>
      </PlatformShell>,
    )
    expect(screen.getByRole('link', { name: /gym/i })).toHaveAttribute('href', '/gym?gameId=xo')
    expect(screen.getByRole('link', { name: /puzzles/i })).toHaveAttribute('href', '/puzzles?gameId=xo')
  })

  it('hides game tabs when the game does not support training or puzzles', () => {
    wrap(
      <PlatformShell
        gameMeta={{ ...xoMeta, supportsTraining: false, supportsPuzzles: false }}
        session={{ isSpectator: true }}
      >
        <div>game</div>
      </PlatformShell>,
    )
    expect(screen.queryByRole('link', { name: /gym/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /puzzles/i })).toBeNull()
  })

  it('shows a Leave button when onLeave is provided, otherwise a Back-to-Tables link', () => {
    const { rerender } = wrap(
      <PlatformShell gameMeta={xoMeta} session={{ isSpectator: true }}>
        <div>game</div>
      </PlatformShell>,
    )
    expect(screen.getByRole('link', { name: /back to tables/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /leave table/i })).toBeNull()

    rerender(
      <MemoryRouter>
        <PlatformShell gameMeta={xoMeta} session={{ isSpectator: true }} onLeave={() => {}}>
          <div>game</div>
        </PlatformShell>
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: /leave table/i })).toBeInTheDocument()
  })
})
