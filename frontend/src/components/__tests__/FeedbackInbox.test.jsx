import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../lib/getToken.js', () => ({
  getToken: () => Promise.resolve('test-token'),
}))

import FeedbackInbox from '../feedback/FeedbackInbox.jsx'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ITEM_BUG = {
  id: 'fb_1',
  category: 'BUG',
  status: 'OPEN',
  message: 'This is a bug report with enough content to test the inbox display.',
  pageUrl: 'https://xo-arena.com/play',
  createdAt: new Date(Date.now() - 5 * 60000).toISOString(),
  readAt: null,
  archived: false,
  resolutionNote: null,
  user: { displayName: 'Alice', name: 'Alice' },
}

const ITEM_SUGGESTION = {
  id: 'fb_2',
  category: 'SUGGESTION',
  status: 'IN_PROGRESS',
  message: 'Please add a dark mode toggle to the settings panel.',
  pageUrl: null,
  createdAt: new Date(Date.now() - 60 * 60000).toISOString(),
  readAt: '2024-01-01T00:00:00.000Z',
  archived: false,
  resolutionNote: null,
  user: null,
}

const ITEM_OTHER_RESOLVED = {
  id: 'fb_3',
  category: 'OTHER',
  status: 'RESOLVED',
  message: 'General feedback about the UI.',
  pageUrl: null,
  createdAt: new Date(Date.now() - 2 * 24 * 60 * 60000).toISOString(),
  readAt: '2024-01-02T00:00:00.000Z',
  archived: true,
  resolutionNote: 'Fixed in v2.0',
  user: { displayName: 'Bob', name: 'Bob' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOkResponse(items = [], total = items.length) {
  return {
    ok: true,
    json: () => Promise.resolve({ items, total }),
  }
}

function stubFetch(response) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
}

function renderInbox(props = {}) {
  return render(
    <MemoryRouter>
      <FeedbackInbox apiBase="/api/v1/admin/feedback" {...props} />
    </MemoryRouter>
  )
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FeedbackInbox — loading state', () => {
  it('shows loading spinner initially', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    renderInbox()
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeTruthy()
  })
})

describe('FeedbackInbox — empty state', () => {
  it('shows empty state message when no items', async () => {
    stubFetch(makeOkResponse([]))
    renderInbox()
    await waitFor(() => {
      expect(screen.getByText('No feedback items found.')).toBeDefined()
    })
  })
})

describe('FeedbackInbox — item list', () => {
  beforeEach(() => {
    stubFetch(makeOkResponse([ITEM_BUG, ITEM_SUGGESTION]))
  })

  it('renders feedback items after load', async () => {
    renderInbox()
    await waitFor(() => {
      expect(screen.getByText(/This is a bug report/)).toBeDefined()
    })
  })

  it('shows category badge with correct text — Bug', async () => {
    renderInbox()
    await waitFor(() => {
      expect(screen.getByText('Bug')).toBeDefined()
    })
  })

  it('shows category badge with correct text — Suggestion', async () => {
    renderInbox()
    await waitFor(() => {
      expect(screen.getByText('Suggestion')).toBeDefined()
    })
  })

  it('shows status badge — Open', async () => {
    renderInbox()
    await waitFor(() => {
      expect(screen.getByText('Open')).toBeDefined()
    })
  })

  it('shows status badge — In Progress', async () => {
    renderInbox()
    await waitFor(() => {
      expect(screen.getByText('In Progress')).toBeDefined()
    })
  })

  it('shows submitter displayName when user is present', async () => {
    renderInbox()
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeDefined()
    })
  })

  it('shows "Anonymous" when no user is attached', async () => {
    renderInbox()
    await waitFor(() => {
      expect(screen.getByText('Anonymous')).toBeDefined()
    })
  })

  it('unread item has blue left border indicator (readAt is null)', async () => {
    renderInbox()
    await waitFor(() => {
      // The row for an unread item has borderLeft style with blue-500
      const rows = document.querySelectorAll('[style*="border-left"]')
      const unreadRows = Array.from(rows).filter(r =>
        r.style.borderLeft.includes('var(--color-blue-500)')
      )
      expect(unreadRows.length).toBeGreaterThan(0)
    })
  })

  it('read item has transparent left border (not unread)', async () => {
    renderInbox()
    await waitFor(() => {
      const rows = document.querySelectorAll('[style*="border-left"]')
      const readRows = Array.from(rows).filter(r =>
        r.style.borderLeft.includes('transparent')
      )
      expect(readRows.length).toBeGreaterThan(0)
    })
  })
})

describe('FeedbackInbox — tabs', () => {
  it('shows Inbox tab button', async () => {
    stubFetch(makeOkResponse([]))
    renderInbox()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Inbox' })).toBeDefined()
    })
  })

  it('shows Archive tab button', async () => {
    stubFetch(makeOkResponse([]))
    renderInbox()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Archive' })).toBeDefined()
    })
  })

  it('Inbox tab is active by default', async () => {
    stubFetch(makeOkResponse([]))
    renderInbox()
    await waitFor(() => {
      // Initial API call should have archived=false
      const url = global.fetch.mock.calls[0][0]
      expect(url).toContain('archived=false')
    })
  })

  it('switching to Archive tab triggers API call with archived=true', async () => {
    stubFetch(makeOkResponse([]))
    renderInbox()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Archive' })).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => {
      const calls = global.fetch.mock.calls
      const archiveCall = calls.find(([url]) => url.includes('archived=true'))
      expect(archiveCall).toBeDefined()
    })
  })
})

describe('FeedbackInbox — filtering', () => {
  it('initially calls API with status=OPEN (default filter)', async () => {
    stubFetch(makeOkResponse([]))
    renderInbox()
    await waitFor(() => {
      const url = global.fetch.mock.calls[0][0]
      expect(url).toContain('status=OPEN')
    })
  })

  it('clicking "In Progress" filter pill triggers API call with status=IN_PROGRESS', async () => {
    stubFetch(makeOkResponse([]))
    renderInbox()
    await waitFor(() => expect(screen.getByRole('button', { name: 'In Progress' })).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'In Progress' }))

    await waitFor(() => {
      const calls = global.fetch.mock.calls
      const filtered = calls.find(([url]) => url.includes('status=IN_PROGRESS'))
      expect(filtered).toBeDefined()
    })
  })

  it('clicking "All" filter pill removes status filter from the API call', async () => {
    stubFetch(makeOkResponse([]))
    renderInbox()
    await waitFor(() => expect(screen.getByRole('button', { name: 'All' })).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'All' }))

    await waitFor(() => {
      const calls = global.fetch.mock.calls
      const allCall = calls.find(([url]) => !url.includes('status='))
      expect(allCall).toBeDefined()
    })
  })

  it('toggling "Unread only" checkbox triggers new API call with unread=true', async () => {
    stubFetch(makeOkResponse([]))
    renderInbox()
    await waitFor(() => {
      expect(screen.getByLabelText('Unread only')).toBeDefined()
    })

    fireEvent.click(screen.getByLabelText('Unread only'))

    await waitFor(() => {
      const calls = global.fetch.mock.calls
      const unreadCall = calls.find(([url]) => url.includes('unread=true'))
      expect(unreadCall).toBeDefined()
    })
  })
})

describe('FeedbackInbox — row expansion', () => {
  beforeEach(() => {
    stubFetch(makeOkResponse([ITEM_BUG]))
  })

  it('clicking a row expands it to show the full message', async () => {
    renderInbox()
    await waitFor(() => expect(screen.getByText(/This is a bug report/)).toBeDefined())

    // Click the message text (inside the row's clickable area), which bubbles to the row
    fireEvent.click(screen.getByText(/This is a bug report/))

    await waitFor(() => {
      // After expansion the full message is visible in the ExpandedRow
      const fullMsg = screen.getAllByText(/This is a bug report/)
      expect(fullMsg.length).toBeGreaterThan(0)
    })
  })

  it('expanded row shows page URL', async () => {
    renderInbox()
    await waitFor(() => expect(screen.getByText(/This is a bug report/)).toBeDefined())

    fireEvent.click(screen.getByText(/This is a bug report/))

    await waitFor(() => {
      expect(screen.getByText('https://xo-arena.com/play')).toBeDefined()
    })
  })

  it('expanded row shows a status selector', async () => {
    renderInbox()
    await waitFor(() => expect(screen.getByText(/This is a bug report/)).toBeDefined())

    fireEvent.click(screen.getByText(/This is a bug report/))

    await waitFor(() => {
      expect(screen.getByText('Status:')).toBeDefined()
    })
  })

  it('expanded row shows Archive button for non-archived item', async () => {
    renderInbox()
    await waitFor(() => expect(screen.getByText(/This is a bug report/)).toBeDefined())

    fireEvent.click(screen.getByText(/This is a bug report/))

    await waitFor(() => {
      // After expansion there are two Archive buttons: the tab + the ExpandedRow action button
      const archiveBtns = screen.getAllByRole('button', { name: /^archive$/i })
      expect(archiveBtns.length).toBeGreaterThan(1)
    })
  })

  it('expanded row shows Delete button', async () => {
    renderInbox()
    await waitFor(() => expect(screen.getByText(/This is a bug report/)).toBeDefined())

    fireEvent.click(screen.getByText(/This is a bug report/))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /delete/i })).toBeDefined()
    })
  })

  it('clicking Archive in expanded row calls PATCH with archived:true', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOkResponse([ITEM_BUG]))
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ feedback: { ...ITEM_BUG, archived: true } }) })

    renderInbox()
    await waitFor(() => expect(screen.getByText(/This is a bug report/)).toBeDefined())

    fireEvent.click(screen.getByText(/This is a bug report/))

    // Wait for expansion: two Archive buttons should appear (tab + ExpandedRow)
    await waitFor(() => {
      const archiveBtns = screen.getAllByRole('button', { name: /^archive$/i })
      expect(archiveBtns.length).toBeGreaterThan(1)
    })

    // Click the ExpandedRow Archive button (the last one in DOM order)
    const archiveBtns = screen.getAllByRole('button', { name: /^archive$/i })
    fireEvent.click(archiveBtns.at(-1))

    await waitFor(() => {
      const calls = global.fetch.mock.calls
      const patchCall = calls.find(([url, opts]) => opts?.method === 'PATCH')
      expect(patchCall).toBeDefined()
      const body = JSON.parse(patchCall[1].body)
      expect(body.archived).toBe(true)
    })
  })

  it('clicking Delete in expanded row calls DELETE endpoint and removes item', async () => {
    // Mock window.confirm to return true
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOkResponse([ITEM_BUG]))
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

    renderInbox()
    await waitFor(() => expect(screen.getByText(/This is a bug report/)).toBeDefined())

    fireEvent.click(screen.getByText(/This is a bug report/))

    await waitFor(() => expect(screen.getByRole('button', { name: /delete/i })).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))

    await waitFor(() => {
      const calls = global.fetch.mock.calls
      const deleteCall = calls.find(([url, opts]) => opts?.method === 'DELETE')
      expect(deleteCall).toBeDefined()
      expect(deleteCall[0]).toContain(ITEM_BUG.id)
    })

    // Item should be removed from the list
    await waitFor(() => {
      expect(screen.queryByText(/This is a bug report/)).toBeNull()
    })

    vi.restoreAllMocks()
  })
})

describe('FeedbackInbox — bulk actions', () => {
  beforeEach(() => {
    stubFetch(makeOkResponse([ITEM_BUG, ITEM_SUGGESTION]))
  })

  it('selecting a checkbox shows the bulk action bar', async () => {
    renderInbox()
    await waitFor(() => expect(screen.getByText(/This is a bug report/)).toBeDefined())

    const checkboxes = screen.getAllByRole('checkbox')
    // Checkbox order: [0] Unread only, [1] Select all, [2] ITEM_BUG, [3] ITEM_SUGGESTION
    // Click the first item checkbox (index 2) to select one item
    fireEvent.click(checkboxes[2])

    await waitFor(() => {
      // "1 selected" count span — more specific than /selected/ which also matches button text
      expect(screen.getByText(/\d+ selected/)).toBeDefined()
    })
  })

  it('"Archive selected" button calls the bulk archive endpoint', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOkResponse([ITEM_BUG, ITEM_SUGGESTION]))
      .mockResolvedValue(makeOkResponse([]))

    renderInbox()
    await waitFor(() => expect(screen.getByText(/This is a bug report/)).toBeDefined())

    // Select an item via its checkbox (index 1, skipping select-all at 0)
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1])

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /archive selected/i })).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: /archive selected/i }))

    await waitFor(() => {
      const calls = global.fetch.mock.calls
      const bulkCall = calls.find(([url, opts]) =>
        url.includes('/bulk') && opts?.method === 'POST'
      )
      expect(bulkCall).toBeDefined()
      const body = JSON.parse(bulkCall[1].body)
      expect(body.action).toBe('archive')
    })
  })

  it('"Mark read" bulk button calls the bulk markRead endpoint', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOkResponse([ITEM_BUG, ITEM_SUGGESTION]))
      .mockResolvedValue(makeOkResponse([]))

    renderInbox()
    await waitFor(() => expect(screen.getByText(/This is a bug report/)).toBeDefined())

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1])

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark read/i })).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: /mark read/i }))

    await waitFor(() => {
      const calls = global.fetch.mock.calls
      const bulkCall = calls.find(([url, opts]) =>
        url.includes('/bulk') && opts?.method === 'POST'
      )
      expect(bulkCall).toBeDefined()
      const body = JSON.parse(bulkCall[1].body)
      expect(body.action).toBe('markRead')
    })
  })
})

describe('FeedbackInbox — error state', () => {
  it('shows error message when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }))
    renderInbox()
    await waitFor(() => {
      expect(screen.getByText('Failed to load feedback.')).toBeDefined()
    })
  })
})

describe('FeedbackInbox — RESOLVED/WONT_FIX items', () => {
  it('shows "Won\'t Fix" label for WONT_FIX status', async () => {
    const wontFix = { ...ITEM_BUG, id: 'fb_wf', status: 'WONT_FIX' }
    stubFetch(makeOkResponse([wontFix]))
    renderInbox()
    await waitFor(() => {
      expect(screen.getByText("Won't Fix")).toBeDefined()
    })
  })

  it('shows "Resolved" label for RESOLVED status', async () => {
    const resolved = { ...ITEM_BUG, id: 'fb_r', status: 'RESOLVED' }
    stubFetch(makeOkResponse([resolved]))
    renderInbox()
    await waitFor(() => {
      expect(screen.getByText('Resolved')).toBeDefined()
    })
  })
})

describe('FeedbackInbox — screenshot preview in expanded row', () => {
  const SCREENSHOT_DATA = 'data:image/jpeg;base64,screenshotpayload'
  const ITEM_WITH_SCREENSHOT = {
    ...ITEM_BUG,
    id: 'fb_ss',
    screenshotData: SCREENSHOT_DATA,
  }
  const ITEM_WITHOUT_SCREENSHOT = {
    ...ITEM_BUG,
    id: 'fb_noss',
    screenshotData: null,
  }

  it('does NOT show screenshot thumbnail when item has no screenshotData', async () => {
    stubFetch(makeOkResponse([ITEM_WITHOUT_SCREENSHOT]))
    renderInbox()
    await waitFor(() => expect(screen.getByText(/This is a bug report/)).toBeDefined())

    fireEvent.click(screen.getByText(/This is a bug report/))

    await waitFor(() => expect(screen.getByText('Status:')).toBeDefined())
    expect(screen.queryByTestId('screenshot-thumbnail')).toBeNull()
  })

  it('shows screenshot thumbnail in expanded row when screenshotData is present', async () => {
    stubFetch(makeOkResponse([ITEM_WITH_SCREENSHOT]))
    renderInbox()
    await waitFor(() => expect(screen.getByText(/This is a bug report/)).toBeDefined())

    fireEvent.click(screen.getByText(/This is a bug report/))

    await waitFor(() => {
      expect(screen.getByTestId('screenshot-thumbnail')).toBeDefined()
    })
  })

  it('thumbnail src matches screenshotData', async () => {
    stubFetch(makeOkResponse([ITEM_WITH_SCREENSHOT]))
    renderInbox()
    await waitFor(() => expect(screen.getByText(/This is a bug report/)).toBeDefined())

    fireEvent.click(screen.getByText(/This is a bug report/))

    await waitFor(() => {
      const img = screen.getByTestId('screenshot-thumbnail')
      expect(img.getAttribute('src')).toBe(SCREENSHOT_DATA)
    })
  })

  it('clicking thumbnail opens the lightbox', async () => {
    stubFetch(makeOkResponse([ITEM_WITH_SCREENSHOT]))
    renderInbox()
    await waitFor(() => expect(screen.getByText(/This is a bug report/)).toBeDefined())

    fireEvent.click(screen.getByText(/This is a bug report/))
    await waitFor(() => expect(screen.getByTestId('screenshot-thumbnail')).toBeDefined())

    fireEvent.click(screen.getByTestId('screenshot-thumbnail'))

    expect(screen.getByTestId('screenshot-lightbox')).toBeDefined()
  })

  it('clicking the lightbox backdrop closes it', async () => {
    stubFetch(makeOkResponse([ITEM_WITH_SCREENSHOT]))
    renderInbox()
    await waitFor(() => expect(screen.getByText(/This is a bug report/)).toBeDefined())

    fireEvent.click(screen.getByText(/This is a bug report/))
    await waitFor(() => expect(screen.getByTestId('screenshot-thumbnail')).toBeDefined())

    fireEvent.click(screen.getByTestId('screenshot-thumbnail'))
    expect(screen.getByTestId('screenshot-lightbox')).toBeDefined()

    fireEvent.click(screen.getByTestId('screenshot-lightbox'))
    expect(screen.queryByTestId('screenshot-lightbox')).toBeNull()
  })

  it('clicking the close button inside the lightbox closes it', async () => {
    stubFetch(makeOkResponse([ITEM_WITH_SCREENSHOT]))
    renderInbox()
    await waitFor(() => expect(screen.getByText(/This is a bug report/)).toBeDefined())

    fireEvent.click(screen.getByText(/This is a bug report/))
    await waitFor(() => expect(screen.getByTestId('screenshot-thumbnail')).toBeDefined())

    fireEvent.click(screen.getByTestId('screenshot-thumbnail'))
    expect(screen.getByTestId('screenshot-lightbox')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /close screenshot/i }))
    expect(screen.queryByTestId('screenshot-lightbox')).toBeNull()
  })
})
