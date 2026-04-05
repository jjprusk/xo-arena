import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AccomplishmentPopup from '../AccomplishmentPopup.jsx'

const TIER_NOTIF = {
  id: 'n1',
  type: 'tier_upgrade',
  payload: { tier: 1, tierName: 'Silver', tierIcon: '🥈', message: "You've reached 🥈 Silver!" },
}

const HPC_NOTIF = {
  id: 'n2',
  type: 'first_hpc',
  payload: { message: 'First PvP game recorded — human play credits are now tracking.' },
}

const MILESTONE_NOTIF = {
  id: 'n3',
  type: 'credit_milestone',
  payload: { score: 100, message: "You've earned 100 activity points!" },
}

describe('AccomplishmentPopup', () => {
  it('renders nothing when notification is null', () => {
    const { container } = render(<AccomplishmentPopup notification={null} onDismiss={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders tier_upgrade with tierName as title', () => {
    render(<AccomplishmentPopup notification={TIER_NOTIF} onDismiss={() => {}} />)
    expect(screen.getByText('Tier Upgrade!')).toBeDefined()
    expect(screen.getByText("You've reached 🥈 Silver!")).toBeDefined()
  })

  it('renders first_hpc with correct title and message', () => {
    render(<AccomplishmentPopup notification={HPC_NOTIF} onDismiss={() => {}} />)
    expect(screen.getByText('First PvP Credit')).toBeDefined()
    expect(screen.getByText('First PvP game recorded — human play credits are now tracking.')).toBeDefined()
  })

  it('renders credit_milestone with correct title', () => {
    render(<AccomplishmentPopup notification={MILESTONE_NOTIF} onDismiss={() => {}} />)
    expect(screen.getByText('Activity Milestone')).toBeDefined()
    expect(screen.getByText("You've earned 100 activity points!")).toBeDefined()
  })

  it('calls onDismiss when "Got it!" is clicked', () => {
    const onDismiss = vi.fn()
    render(<AccomplishmentPopup notification={HPC_NOTIF} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /got it/i }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('shows the popup overlay', () => {
    render(<AccomplishmentPopup notification={HPC_NOTIF} onDismiss={() => {}} />)
    expect(document.querySelector('[data-testid="accomplishment-popup"]')).toBeTruthy()
  })

  it('renders unknown type with fallback title', () => {
    const notif = { id: 'n9', type: 'unknown_type', payload: { message: 'Something happened' } }
    render(<AccomplishmentPopup notification={notif} onDismiss={() => {}} />)
    expect(screen.getByText('Achievement Unlocked')).toBeDefined()
    expect(screen.getByText('Something happened')).toBeDefined()
  })
})
