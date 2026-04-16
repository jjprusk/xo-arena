import React from 'react'
import { describe, it, expect } from 'vitest'
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
  it('seated player actively playing → focused', () => {
    expect(selectDefaultMode({ isSpectator: false, phase: 'playing' })).toBe('focused')
  })
  it('spectator → chrome-present regardless of phase', () => {
    expect(selectDefaultMode({ isSpectator: true,  phase: 'playing' })).toBe('chrome-present')
    expect(selectDefaultMode({ isSpectator: true,  phase: 'finished' })).toBe('chrome-present')
  })
  it('seated but waiting/finished → chrome-present', () => {
    expect(selectDefaultMode({ isSpectator: false, phase: 'waiting' })).toBe('chrome-present')
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
      '--game-mark-x': '#eee',  // dark override wins
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

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('PlatformShell — focused mode', () => {
  it('renders the game in a focused frame with back affordance', () => {
    wrap(
      <PlatformShell gameMeta={xoMeta} phase="playing" session={{ isSpectator: false }}>
        <div data-testid="game">BOARD</div>
      </PlatformShell>,
    )
    const frame = screen.getByTestId('game').closest('[data-shell-mode]')
    expect(frame).toHaveAttribute('data-shell-mode', 'focused')
    expect(screen.getByRole('link', { name: /back/i })).toBeInTheDocument()
  })

  it('honors initialMode="focused" even when the session would default otherwise', () => {
    wrap(
      <PlatformShell gameMeta={xoMeta} session={{ isSpectator: true }} initialMode="focused">
        <div data-testid="game">BOARD</div>
      </PlatformShell>,
    )
    const frame = screen.getByTestId('game').closest('[data-shell-mode]')
    expect(frame).toHaveAttribute('data-shell-mode', 'focused')
  })

  it('toggling ⤢ switches to chrome-present mode and reveals the sidebar', () => {
    wrap(
      <PlatformShell gameMeta={xoMeta} phase="playing" session={{ isSpectator: false }}>
        <div data-testid="game">BOARD</div>
      </PlatformShell>,
    )
    fireEvent.click(screen.getByRole('button', { name: /show table context/i }))
    const frame = screen.getByTestId('game').closest('[data-shell-mode]')
    expect(frame).toHaveAttribute('data-shell-mode', 'chrome-present')
    expect(screen.getByRole('complementary', { name: /table context/i })).toBeInTheDocument()
  })
})

describe('PlatformShell — chrome-present mode', () => {
  it('renders the table context sidebar with game title + status + players', () => {
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
