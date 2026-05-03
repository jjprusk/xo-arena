// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../lib/getToken.js', () => ({
  getToken: vi.fn(() => Promise.resolve('test-token')),
}))

vi.mock('../../../lib/api.js', () => ({
  api: {
    admin: {
      getGuideConfig: vi.fn(),
      setGuideConfig: vi.fn(),
    },
  },
}))

const { api } = await import('../../../lib/api.js')
const GuideConfigPanel = (await import('../GuideConfigPanel.jsx')).default

const FIXTURE = {
  'guide.v1.enabled':                                 true,
  'guide.rewards.hookComplete':                       20,
  'guide.rewards.curriculumComplete':                 50,
  'guide.rewards.discovery.firstSpecializeAction':    10,
  'guide.rewards.discovery.firstRealTournamentWin':   25,
  'guide.rewards.discovery.firstNonDefaultAlgorithm': 10,
  'guide.rewards.discovery.firstTemplateClone':       10,
  'guide.quickBot.defaultTier':                       'novice',
  'guide.quickBot.firstTrainingTier':                 'intermediate',
  'guide.cup.sizeEntrants':                           4,
  'guide.cup.retentionDays':                          30,
  'guide.demo.ttlMinutes':                            60,
  'metrics.internalEmailDomains':                     ['callidity.com'],
}

beforeEach(() => {
  vi.clearAllMocks()
  api.admin.getGuideConfig.mockResolvedValue({ config: FIXTURE })
  api.admin.setGuideConfig.mockResolvedValue({ config: FIXTURE })
})

describe('GuideConfigPanel', () => {
  it('loads and renders all 13 keys with current values', async () => {
    render(<GuideConfigPanel />)

    // Reward field — value 20
    const hookInput = await screen.findByLabelText('guide.rewards.hookComplete')
    expect(hookInput.value).toBe('20')

    // Tier select — value 'novice'
    const tierSelect = screen.getByLabelText('guide.quickBot.defaultTier')
    expect(tierSelect.value).toBe('novice')

    // Cup entrants — read-only, disabled, value 4
    const cup = screen.getByLabelText('guide.cup.sizeEntrants')
    expect(cup.value).toBe('4')
    expect(cup.disabled).toBe(true)

    // Internal domains — pre-joined CSV
    const domains = screen.getByLabelText('metrics.internalEmailDomains')
    expect(domains.value).toBe('callidity.com')

    // Release flag checked
    const flag = screen.getByLabelText('guide.v1.enabled')
    expect(flag.checked).toBe(true)
  })

  it('PATCHes only the fields that changed', async () => {
    render(<GuideConfigPanel />)
    const hookInput = await screen.findByLabelText('guide.rewards.hookComplete')

    fireEvent.change(hookInput, { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(api.admin.setGuideConfig).toHaveBeenCalledTimes(1))
    const [body] = api.admin.setGuideConfig.mock.calls[0]
    expect(body).toEqual({ 'guide.rewards.hookComplete': 25 })
  })

  it('parses the comma-separated domains into an array on save', async () => {
    render(<GuideConfigPanel />)
    const domains = await screen.findByLabelText('metrics.internalEmailDomains')

    fireEvent.change(domains, { target: { value: ' callidity.com , example.com ' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(api.admin.setGuideConfig).toHaveBeenCalled())
    const [body] = api.admin.setGuideConfig.mock.calls[0]
    expect(body['metrics.internalEmailDomains']).toEqual(['callidity.com', 'example.com'])
  })

  it('skips domains in the patch body when unchanged', async () => {
    render(<GuideConfigPanel />)
    const hookInput = await screen.findByLabelText('guide.rewards.hookComplete')

    fireEvent.change(hookInput, { target: { value: '21' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(api.admin.setGuideConfig).toHaveBeenCalled())
    const [body] = api.admin.setGuideConfig.mock.calls[0]
    expect(body['metrics.internalEmailDomains']).toBeUndefined()
  })

  it('confirms before disabling guide.v1.enabled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<GuideConfigPanel />)
    const flag = await screen.findByLabelText('guide.v1.enabled')

    fireEvent.click(flag)  // toggles off
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0][0]).toMatch(/disable/i)
    // User cancelled → no PATCH fired
    expect(api.admin.setGuideConfig).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('does NOT confirm when re-enabling guide.v1.enabled', async () => {
    api.admin.getGuideConfig.mockResolvedValue({ config: { ...FIXTURE, 'guide.v1.enabled': false } })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<GuideConfigPanel />)
    const flag = await screen.findByLabelText('guide.v1.enabled')
    expect(flag.checked).toBe(false)

    fireEvent.click(flag)  // toggles on
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(api.admin.setGuideConfig).toHaveBeenCalled())
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(api.admin.setGuideConfig.mock.calls[0][0]).toEqual({ 'guide.v1.enabled': true })
    confirmSpy.mockRestore()
  })

  it('shows an error when the API rejects', async () => {
    api.admin.setGuideConfig.mockRejectedValueOnce(new Error('boom'))
    render(<GuideConfigPanel />)
    const hookInput = await screen.findByLabelText('guide.rewards.hookComplete')
    fireEvent.change(hookInput, { target: { value: '999' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByText(/boom/i)).toBeDefined()
  })

  it('renders the load-error state when GET fails', async () => {
    api.admin.getGuideConfig.mockRejectedValueOnce(new Error('nope'))
    render(<GuideConfigPanel />)
    expect(await screen.findByText(/failed to load/i)).toBeDefined()
  })
})
