import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../../lib/api.js', () => ({
  api: {
    admin: {
      listModels: vi.fn(),
      featureModel: vi.fn(),
      deleteModel: vi.fn(),
      setModelMaxEpisodes: vi.fn(),
    },
  },
}))

vi.mock('../../../lib/getToken.js', () => ({
  getToken: () => Promise.resolve('test-token'),
}))

vi.mock('../AdminDashboard.jsx', () => ({
  AdminHeader: ({ title, subtitle }) => (
    <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
  ),
  Spinner: () => <div data-testid="spinner">Loading</div>,
  ErrorMsg: ({ children }) => <p data-testid="error">{children}</p>,
}))

vi.mock('../../../components/ui/ListTable.jsx', () => ({
  ListTable: ({ children }) => <table>{children}</table>,
  ListTh: ({ children }) => <th>{children}</th>,
  ListTd: ({ children }) => <td>{children}</td>,
  ListTr: ({ children }) => <tr>{children}</tr>,
  SearchBar: ({ value, onChange, placeholder }) => (
    <input
      data-testid="search"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
  ListPagination: () => null,
}))

import { api } from '../../../lib/api.js'
import AdminMLPage from '../AdminMLPage.jsx'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MOCK_MODEL = {
  id: 'model_1',
  name: 'QuantumNet',
  creatorName: 'Alice',
  algorithm: 'dqn',
  status: 'IDLE',
  totalEpisodes: 500,
  maxEpisodes: 1000,
  eloRating: 1350,
  featured: false,
  _count: { sessions: 3 },
}

const FEATURED_MODEL = { ...MOCK_MODEL, id: 'model_2', featured: true }

const renderPage = () =>
  render(<MemoryRouter><AdminMLPage /></MemoryRouter>)

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AdminMLPage — heading', () => {
  it('renders "Bots" heading', async () => {
    api.admin.listModels.mockResolvedValue({ models: [], total: 0 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^bots$/i })).toBeDefined()
    })
  })
})

describe('AdminMLPage — empty state', () => {
  it('shows "No bots found." when API returns empty array', async () => {
    api.admin.listModels.mockResolvedValue({ models: [], total: 0 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('No bots found.')).toBeDefined()
    })
  })
})

describe('AdminMLPage — error state', () => {
  it('shows error message when API rejects', async () => {
    api.admin.listModels.mockRejectedValue(new Error('network error'))
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('error')).toBeDefined()
      expect(screen.getByTestId('error').textContent).toContain('Failed to load bots.')
    })
  })
})

describe('AdminMLPage — bot list', () => {
  it('renders model name in the table', async () => {
    api.admin.listModels.mockResolvedValue({ models: [MOCK_MODEL], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('QuantumNet')).toBeDefined()
    })
  })

  it('shows feature button (☆) for unfeatured model', async () => {
    api.admin.listModels.mockResolvedValue({ models: [MOCK_MODEL], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /☆/ })).toBeDefined()
    })
  })

  it('shows feature star (⭐) in actions for featured model', async () => {
    api.admin.listModels.mockResolvedValue({ models: [FEATURED_MODEL], total: 1 })
    renderPage()
    await waitFor(() => {
      // The featured action button renders ⭐ and has title="Unfeature"
      const btn = screen.getByTitle('Unfeature')
      expect(btn).toBeDefined()
      expect(btn.textContent).toContain('⭐')
    })
  })
})

describe('AdminMLPage — delete flow', () => {
  it('clicking Delete shows Confirm and Cancel buttons', async () => {
    api.admin.listModels.mockResolvedValue({ models: [MOCK_MODEL], total: 1 })
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^delete$/i })).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^confirm$/i })).toBeDefined()
      expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDefined()
    })
  })

  it('clicking Confirm calls api.admin.deleteModel with model id', async () => {
    api.admin.listModels.mockResolvedValue({ models: [MOCK_MODEL], total: 1 })
    api.admin.deleteModel.mockResolvedValue({})
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^delete$/i })).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^confirm$/i })).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }))

    await waitFor(() => {
      expect(api.admin.deleteModel).toHaveBeenCalledWith('model_1', 'test-token')
    })
  })
})
