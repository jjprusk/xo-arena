// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BotCard from '../BotCard.jsx'

const baseBot = {
  id:             'b_1',
  displayName:    'Sterling One',
  avatarUrl:      null,
  botOwnerId:     'u_alice',
  botProvisional: false,
  botGamesPlayed: 42,
  gameElo:        [{ rating: 1532.4 }],
}

describe('<BotCard />', () => {
  it('renders nothing for a missing bot prop', () => {
    const { container } = render(<BotCard bot={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders displayName, ELO (rounded), and games-played', () => {
    render(<BotCard bot={baseBot} />)
    expect(screen.getByText('Sterling One')).toBeTruthy()
    expect(screen.getByTestId('bot-card-rating').textContent).toBe('ELO 1532')
    expect(screen.getByText('42 games')).toBeTruthy()
  })

  it('shows "Community" label for ownerless bots', () => {
    render(<BotCard bot={{ ...baseBot, botOwnerId: null }} />)
    expect(screen.getByText('Community')).toBeTruthy()
  })

  it('shows "new" badge for provisional bots', () => {
    render(<BotCard bot={{ ...baseBot, botProvisional: true }} />)
    expect(screen.getByText('new')).toBeTruthy()
  })

  it('hides ELO line when gameElo is empty (still renders the card)', () => {
    render(<BotCard bot={{ ...baseBot, gameElo: [] }} />)
    expect(screen.getByText('Sterling One')).toBeTruthy()
    expect(screen.queryByTestId('bot-card-rating')).toBeNull()
  })

  it('renders the actions slot in non-interactive variants', () => {
    render(
      <BotCard
        bot={baseBot}
        actions={<button data-testid="custom-action">x</button>}
      />,
    )
    expect(screen.getByTestId('custom-action')).toBeTruthy()
  })

  it('select variant becomes a clickable button and fires onSelect', () => {
    const onSelect = vi.fn()
    render(<BotCard bot={baseBot} variant="select" onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId('bot-card'))
    expect(onSelect).toHaveBeenCalledWith(baseBot)
  })

  it('select variant suppresses the action slot to avoid double-tap targets', () => {
    render(
      <BotCard
        bot={baseBot}
        variant="select"
        onSelect={() => {}}
        actions={<button data-testid="should-not-render">x</button>}
      />,
    )
    expect(screen.queryByTestId('should-not-render')).toBeNull()
  })

  it('truncates long names via the title attribute (full name preserved)', () => {
    const longName = 'A really really really long bot name that overflows'
    render(<BotCard bot={{ ...baseBot, displayName: longName }} />)
    const span = screen.getByText(longName)
    expect(span.getAttribute('title')).toBe(longName)
  })

  // ── A4.4 — picker disambiguation ───────────────────────────────────
  // When a multi-skill bot is rendered in a picker that's scoped to one
  // game, the card shows "Name (Game)" so the user can tell which skill
  // they're queueing. Single-game bots stay un-suffixed.

  it('appends " (Game)" when bot has skills in multiple games AND pickerGameId is set', () => {
    render(
      <BotCard
        bot={{ ...baseBot, playableGameIds: ['tic-tac-toe', 'connect-four'] }}
        variant="select"
        onSelect={() => {}}
        pickerGameId="tic-tac-toe"
      />,
    )
    expect(screen.getByText('Sterling One (Tic-tac-toe)')).toBeTruthy()
  })

  it('does NOT append a suffix when the bot only plays one game', () => {
    render(
      <BotCard
        bot={{ ...baseBot, playableGameIds: ['tic-tac-toe'] }}
        variant="select"
        onSelect={() => {}}
        pickerGameId="tic-tac-toe"
      />,
    )
    expect(screen.getByText('Sterling One')).toBeTruthy()
    expect(screen.queryByText(/Sterling One \(/)).toBeNull()
  })

  it('does NOT append a suffix when pickerGameId is not provided', () => {
    render(
      <BotCard
        bot={{ ...baseBot, playableGameIds: ['tic-tac-toe', 'connect-four'] }}
      />,
    )
    expect(screen.getByText('Sterling One')).toBeTruthy()
  })

  it('falls back to the raw gameId when the picker game is unknown', () => {
    render(
      <BotCard
        bot={{ ...baseBot, playableGameIds: ['tic-tac-toe', 'mystery-game'] }}
        variant="select"
        onSelect={() => {}}
        pickerGameId="mystery-game"
      />,
    )
    expect(screen.getByText('Sterling One (mystery-game)')).toBeTruthy()
  })
})
