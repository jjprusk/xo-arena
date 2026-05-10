// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BotFilterBar from '../BotFilterBar.jsx'

describe('<BotFilterBar />', () => {
  it('renders the three owner tabs by default', () => {
    render(<BotFilterBar value={{}} onChange={() => {}} />)
    expect(screen.getByTestId('bot-filter-owner-mine')).toBeTruthy()
    expect(screen.getByTestId('bot-filter-owner-community')).toBeTruthy()
    expect(screen.getByTestId('bot-filter-owner-all')).toBeTruthy()
  })

  it('hides the "My bots" tab when ownerToggleAllowsMine=false', () => {
    render(<BotFilterBar value={{}} onChange={() => {}} ownerToggleAllowsMine={false} />)
    expect(screen.queryByTestId('bot-filter-owner-mine')).toBeNull()
    expect(screen.getByTestId('bot-filter-owner-community')).toBeTruthy()
    expect(screen.getByTestId('bot-filter-owner-all')).toBeTruthy()
  })

  it('marks the active tab via data-active', () => {
    render(<BotFilterBar value={{ owner: 'community' }} onChange={() => {}} />)
    expect(screen.getByTestId('bot-filter-owner-community').getAttribute('data-active')).toBe('true')
    expect(screen.getByTestId('bot-filter-owner-mine').getAttribute('data-active')).toBe('false')
  })

  it('emits onChange with merged owner key when a tab is clicked', () => {
    const onChange = vi.fn()
    render(<BotFilterBar value={{ search: 'sterling' }} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('bot-filter-owner-community'))
    expect(onChange).toHaveBeenCalledWith({ search: 'sterling', owner: 'community' })
  })

  it('emits onChange when typing in the search input', () => {
    const onChange = vi.fn()
    render(<BotFilterBar value={{}} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('bot-filter-search'), { target: { value: 'rookie' } })
    expect(onChange).toHaveBeenCalledWith({ search: 'rookie' })
  })

  it('coerces ELO inputs to numbers when typed', () => {
    const onChange = vi.fn()
    render(<BotFilterBar value={{}} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('bot-filter-elo-min'), { target: { value: '1200' } })
    expect(onChange).toHaveBeenCalledWith({ eloMin: 1200 })
  })

  it('coerces a cleared ELO input to undefined', () => {
    const onChange = vi.fn()
    render(<BotFilterBar value={{ eloMin: 1200 }} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('bot-filter-elo-min'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith({ eloMin: undefined })
  })

  it('Reset button emits onChange({}) clearing every filter', () => {
    const onChange = vi.fn()
    render(
      <BotFilterBar
        value={{ owner: 'mine', search: 'x', eloMin: 1000, eloMax: 2000 }}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByTestId('bot-filter-reset'))
    expect(onChange).toHaveBeenCalledWith({})
  })

  it('does NOT crash when onChange is omitted', () => {
    render(<BotFilterBar value={{}} />)
    expect(() => fireEvent.click(screen.getByTestId('bot-filter-reset'))).not.toThrow()
  })
})
