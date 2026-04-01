import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../AdminDashboard.jsx', () => ({
  AdminHeader: ({ title, subtitle }) => (
    <div>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  ),
  Spinner: () => <div data-testid="spinner">Loading</div>,
  ErrorMsg: ({ children }) => <p data-testid="error">{children}</p>,
}))

vi.mock('../../../components/feedback/FeedbackInbox.jsx', () => ({
  default: ({ apiBase }) => (
    <div data-testid="feedback-inbox" data-api-base={apiBase}>
      FeedbackInbox Stub
    </div>
  ),
}))

import AdminFeedbackPage from '../AdminFeedbackPage.jsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminFeedbackPage />
    </MemoryRouter>
  )
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminFeedbackPage — heading', () => {
  it('renders page with "Feedback" heading', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /feedback/i })).toBeDefined()
  })

  it('renders the subtitle about bug reports', () => {
    renderPage()
    expect(screen.getByText(/user-submitted feedback/i)).toBeDefined()
  })
})

describe('AdminFeedbackPage — FeedbackInbox', () => {
  it('renders the FeedbackInbox component', () => {
    renderPage()
    expect(screen.getByTestId('feedback-inbox')).toBeDefined()
  })

  it('passes the correct apiBase prop to FeedbackInbox', () => {
    renderPage()
    const inbox = screen.getByTestId('feedback-inbox')
    expect(inbox.getAttribute('data-api-base')).toBe('/api/v1/admin/feedback')
  })
})
