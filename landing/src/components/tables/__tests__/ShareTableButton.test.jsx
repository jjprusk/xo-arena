import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ShareTableButton from '../ShareTableButton.jsx'

beforeEach(() => {
  // Fresh clipboard mock each test
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

describe('ShareTableButton — icon variant (list row)', () => {
  it('copies /tables/:id URL using the current origin', async () => {
    // jsdom sets a default origin; we just check what the component sent
    render(<ShareTableButton tableId="tbl_1" variant="icon" />)
    const btn = screen.getByRole('button', { name: /share table link/i })
    const { act } = await import('react')
    await act(async () => { btn.click() })
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    const url = navigator.clipboard.writeText.mock.calls[0][0]
    expect(url).toMatch(/\/tables\/tbl_1$/)
    expect(url.startsWith('http')).toBe(true)
  })

  it('flips to a checkmark + copied label briefly on success', async () => {
    render(<ShareTableButton tableId="tbl_1" variant="icon" />)
    const btn = screen.getByRole('button', { name: /share table link/i })
    const { act } = await import('react')
    await act(async () => { btn.click() })
    await waitFor(() => expect(btn.textContent).toContain('✓'))
    expect(btn.getAttribute('aria-label')).toMatch(/copied/)
  })

  it('does not navigate/bubble — calls stopPropagation on the event', async () => {
    const onRowClick = vi.fn()
    render(
      <div onClick={onRowClick}>
        <ShareTableButton tableId="tbl_1" variant="icon" />
      </div>,
    )
    const btn = screen.getByRole('button', { name: /share table link/i })
    const { act } = await import('react')
    await act(async () => { btn.click() })
    expect(navigator.clipboard.writeText).toHaveBeenCalled()
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('renders a "failed" state when the clipboard API rejects', async () => {
    navigator.clipboard.writeText = vi.fn().mockRejectedValue(new Error('denied'))
    // Remove execCommand path by blanking document.execCommand in this test
    const origExec = document.execCommand
    document.execCommand = undefined
    render(<ShareTableButton tableId="tbl_1" variant="icon" />)
    const btn = screen.getByRole('button', { name: /share table link/i })
    const { act } = await import('react')
    await act(async () => { btn.click() })
    await waitFor(() => expect(btn.textContent).toContain('!'))
    document.execCommand = origExec
  })
})

describe('ShareTableButton — full variant (detail page)', () => {
  it('renders a Share label and copies on click', async () => {
    render(<ShareTableButton tableId="tbl_9" variant="full" />)
    const btn = screen.getByRole('button', { name: /share/i })
    expect(btn.textContent).toContain('Share')
    const { act } = await import('react')
    await act(async () => { btn.click() })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\/tables\/tbl_9$/),
    )
    await waitFor(() => expect(btn.textContent).toContain('Copied!'))
  })
})
