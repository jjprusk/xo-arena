import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mock api
vi.mock('../../lib/api.js', () => ({
  api: {
    get: vi.fn(),
  },
}))

// Mock socket
vi.mock('../../lib/socket.js', () => ({
  getSocket: () => ({
    on: vi.fn(),
    off: vi.fn(),
  }),
}))

import { api } from '../../lib/api.js'
import LogViewerPage from '../LogViewerPage.jsx'

const SAMPLE_LOGS = [
  { id: '1', timestamp: '2026-03-18T10:00:00Z', level: 'INFO', source: 'api', message: 'Server started', meta: null },
  { id: '2', timestamp: '2026-03-18T10:01:00Z', level: 'ERROR', source: 'frontend', message: 'Uncaught error', meta: { stack: 'Error at foo.js:1' } },
  { id: '3', timestamp: '2026-03-18T10:02:00Z', level: 'WARN', source: 'realtime', message: 'Reconnect attempt', meta: null },
  { id: '4', timestamp: '2026-03-18T10:03:00Z', level: 'DEBUG', source: 'ai', message: 'Minimax evaluated', meta: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ logs: SAMPLE_LOGS, total: SAMPLE_LOGS.length })
})

describe('LogViewerPage', () => {
  it('renders heading and level pills', async () => {
    render(<LogViewerPage />)
    expect(screen.getByText('Log Viewer')).toBeDefined()
    expect(screen.getByText('INFO')).toBeDefined()
    expect(screen.getByText('ERROR')).toBeDefined()
    expect(screen.getByText('WARN')).toBeDefined()
    expect(screen.getByText('DEBUG')).toBeDefined()
    expect(screen.getByText('FATAL')).toBeDefined()
  })

  it('fetches logs on mount and displays them', async () => {
    render(<LogViewerPage />)
    await waitFor(() => {
      expect(screen.getByText('Server started')).toBeDefined()
      expect(screen.getByText('Uncaught error')).toBeDefined()
    })
    expect(api.get).toHaveBeenCalledWith('/logs')
  })

  it('DEBUG logs are hidden by default (not in active levels)', async () => {
    render(<LogViewerPage />)
    await waitFor(() => {
      expect(screen.getByText('Server started')).toBeDefined()
    })
    // DEBUG log should be filtered out since activeLevels defaults exclude it
    expect(screen.queryByText('Minimax evaluated')).toBeNull()
  })

  it('toggling DEBUG level shows debug logs', async () => {
    render(<LogViewerPage />)
    await waitFor(() => expect(screen.getByText('Server started')).toBeDefined())

    fireEvent.click(screen.getByText('DEBUG'))
    await waitFor(() => {
      expect(screen.getByText('Minimax evaluated')).toBeDefined()
    })
  })

  it('toggling a source filter hides its logs', async () => {
    render(<LogViewerPage />)
    await waitFor(() => expect(screen.getByText('Server started')).toBeDefined())

    // 'api' source pill is the first match (the filter button)
    fireEvent.click(screen.getAllByText('api')[0])
    await waitFor(() => {
      expect(screen.queryByText('Server started')).toBeNull()
    })
    // Other sources still visible
    expect(screen.getByText('Uncaught error')).toBeDefined()
  })

  it('text search filters by message', async () => {
    render(<LogViewerPage />)
    await waitFor(() => expect(screen.getByText('Server started')).toBeDefined())

    const searchInput = screen.getByPlaceholderText('Search message…')
    fireEvent.change(searchInput, { target: { value: 'Reconnect' } })

    await waitFor(() => {
      expect(screen.getByText('Reconnect attempt')).toBeDefined()
      expect(screen.queryByText('Server started')).toBeNull()
      expect(screen.queryByText('Uncaught error')).toBeNull()
    })
  })

  it('expanding a log row shows its meta JSON', async () => {
    render(<LogViewerPage />)
    await waitFor(() => expect(screen.getByText('Uncaught error')).toBeDefined())

    // Click on the ERROR log row to expand
    fireEvent.click(screen.getByText('Uncaught error'))
    await waitFor(() => {
      // JSON.stringify of the meta object should be shown
      expect(screen.getByText(/Error at foo.js:1/)).toBeDefined()
    })
  })

  it('shows entry count in status bar', async () => {
    render(<LogViewerPage />)
    await waitFor(() => {
      // 3 entries should match: INFO, ERROR, WARN (DEBUG excluded by default)
      expect(screen.getByText(/3 of 4 entries/)).toBeDefined()
    })
  })

  it('export buttons are present', async () => {
    render(<LogViewerPage />)
    await waitFor(() => expect(screen.getByText('Server started')).toBeDefined())
    expect(screen.getByText('↓ JSON')).toBeDefined()
    expect(screen.getByText('↓ CSV')).toBeDefined()
  })
})
