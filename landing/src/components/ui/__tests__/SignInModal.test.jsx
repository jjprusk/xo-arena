// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Auth-client surface used by SignInModal
vi.mock('../../../lib/auth-client.js', () => ({
  signIn:                { email: vi.fn() },
  signUp:                { email: vi.fn() },
  forgetPassword:        vi.fn(),
  sendVerificationEmail: vi.fn(),
}))

vi.mock('../../../lib/useOptimisticSession.js', () => ({
  triggerSessionRefresh: vi.fn(),
}))

vi.mock('../../../lib/getToken.js', () => ({
  clearTokenCache: vi.fn(),
  getToken:        vi.fn(() => Promise.resolve('test-token')),
}))

vi.mock('../../../lib/api.js', () => ({
  api: {
    guide: { guestCredit: vi.fn(() => Promise.resolve({})) },
    // sync is awaited before guestCredit to ensure the domain User row
    // exists; the credit endpoint 404s otherwise.
    users: { sync:        vi.fn(() => Promise.resolve({ user: { id: 'u1' } })) },
  },
}))

// Social buttons: rendered as inert stubs so we don't have to model their internals.
vi.mock('../GoogleSignInButton.jsx', () => ({ default: () => <div /> }))
vi.mock('../AppleSignInButton.jsx',  () => ({ default: () => <div /> }))

import { signUp } from '../../../lib/auth-client.js'
import { api }    from '../../../lib/api.js'
import SignInModal from '../SignInModal.jsx'

const STORAGE_KEY = 'guideGuestJourney'

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderModal(props = {}) {
  return render(<SignInModal onClose={vi.fn()} {...props} />)
}

// Bypass the "submit too fast" 3-second guard by advancing Date.now() AFTER
// the form has mounted and stamped formStartedAt.
function bypassSubmitDelayGuard() {
  const realNow = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(realNow + 5000)
}

function fillSignupForm({ email, password }) {
  fireEvent.change(screen.getByPlaceholderText(/^email$/i), { target: { value: email } })
  fireEvent.change(screen.getByPlaceholderText(/min\. 8/i),   { target: { value: password } })
  fireEvent.change(screen.getByPlaceholderText(/confirm password/i), { target: { value: password } })
}

describe('SignInModal — build-bot contextual copy', () => {
  it('shows generic "Create your account" title without context', () => {
    renderModal({ defaultView: 'sign-up' })
    expect(screen.getByRole('heading', { name: /create your account/i })).toBeDefined()
  })

  it('shows "Build your first bot" title when context=build-bot', () => {
    renderModal({ defaultView: 'sign-up', context: 'build-bot' })
    expect(screen.getByRole('heading', { name: /build your first bot/i })).toBeDefined()
    expect(screen.getByText(/competes in tournaments/i)).toBeDefined()
  })

  it('keeps the standard sign-in title regardless of context', () => {
    renderModal({ defaultView: 'sign-in', context: 'build-bot' })
    expect(screen.getByRole('heading', { name: /sign in to ai arena/i })).toBeDefined()
  })
})

describe('SignInModal — deferred email verification on signup', () => {
  it('closes the modal on signup success — never shows the verify-email view', async () => {
    const onClose = vi.fn()
    signUp.email.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: false } })

    render(<SignInModal onClose={onClose} defaultView="sign-up" />)
    bypassSubmitDelayGuard()

    fillSignupForm({ email: 'newuser@example.com', password: 'password123' })
    fireEvent.submit(screen.getByRole('button', { name: /create account/i }).closest('form'))

    await waitFor(() => expect(signUp.email).toHaveBeenCalled())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    // Crucially, the legacy "Check your email" verify wall must NOT appear.
    expect(screen.queryByText(/check your email/i)).toBeNull()
  })

  it('credits guest journey progress on successful signup', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      hookStep1CompletedAt: '2026-04-24T12:00:00.000Z',
      hookStep2CompletedAt: '2026-04-24T12:05:00.000Z',
    }))
    signUp.email.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: false } })

    render(<SignInModal onClose={vi.fn()} defaultView="sign-up" />)
    bypassSubmitDelayGuard()

    fillSignupForm({ email: 'guest@example.com', password: 'password123' })
    fireEvent.submit(screen.getByRole('button', { name: /create account/i }).closest('form'))

    await waitFor(() => expect(api.guide.guestCredit).toHaveBeenCalled())
    const [payload, token] = api.guide.guestCredit.mock.calls[0]
    expect(payload.hookStep1CompletedAt).toBe('2026-04-24T12:00:00.000Z')
    expect(payload.hookStep2CompletedAt).toBe('2026-04-24T12:05:00.000Z')
    expect(token).toBe('test-token')

    // localStorage cleared after successful credit
    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull())
  })

  it('calls users.sync before guestCredit so the domain User row exists', async () => {
    // Without sync, guestCredit 404'd on a fresh signup because the
    // backend's /guide/guest-credit handler returns 404 when the User row
    // hasn't been created yet. sync() upserts it; guestCredit must wait.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      hookStep1CompletedAt: '2026-04-24T12:00:00.000Z',
    }))
    signUp.email.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: false } })

    render(<SignInModal onClose={vi.fn()} defaultView="sign-up" />)
    bypassSubmitDelayGuard()

    fillSignupForm({ email: 'guest@example.com', password: 'password123' })
    fireEvent.submit(screen.getByRole('button', { name: /create account/i }).closest('form'))

    await waitFor(() => expect(api.guide.guestCredit).toHaveBeenCalled())
    // Both must have been called, and sync's invocation order must precede
    // guestCredit's (vi.fn().mock.invocationCallOrder is monotonic across
    // all mocks in the run).
    expect(api.users.sync).toHaveBeenCalled()
    const syncOrder    = api.users.sync.mock.invocationCallOrder[0]
    const creditOrder  = api.guide.guestCredit.mock.invocationCallOrder[0]
    expect(syncOrder).toBeLessThan(creditOrder)
  })

  it('does not call guestCredit when localStorage holds malformed JSON (task #34)', async () => {
    // Corrupted localStorage shouldn't crash the signup or fire a bad post.
    // readGuestJourney returns {} on parse failure → hasGuestProgress is
    // false → guestCredit isn't called → signup completes cleanly.
    window.localStorage.setItem(STORAGE_KEY, '{not json{')
    signUp.email.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: false } })

    render(<SignInModal onClose={vi.fn()} defaultView="sign-up" />)
    bypassSubmitDelayGuard()

    fillSignupForm({ email: 'guest@example.com', password: 'password123' })
    fireEvent.submit(screen.getByRole('button', { name: /create account/i }).closest('form'))

    await waitFor(() => expect(signUp.email).toHaveBeenCalled())
    expect(api.guide.guestCredit).not.toHaveBeenCalled()
  })

  it('signup completes cleanly even if guestCredit rejects (task #34)', async () => {
    // The guest-credit POST is best-effort — a 500 from /guest-credit must
    // NOT block the signup completion or surface as a user-facing error.
    // The user is already authenticated; the worst case is starting at
    // step 0 instead of step 2, which the next page load can re-credit
    // (the bridge fires when they next play a PvAI game).
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      hookStep1CompletedAt: '2026-04-24T12:00:00.000Z',
    }))
    signUp.email.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: false } })
    api.guide.guestCredit.mockRejectedValueOnce(new Error('server 500'))

    render(<SignInModal onClose={vi.fn()} defaultView="sign-up" />)
    bypassSubmitDelayGuard()

    fillSignupForm({ email: 'guest@example.com', password: 'password123' })
    fireEvent.submit(screen.getByRole('button', { name: /create account/i }).closest('form'))

    await waitFor(() => expect(api.guide.guestCredit).toHaveBeenCalled())
    // No catastrophic UI error — the verification screen still appears (or
    // the modal still closes cleanly). Critically, no thrown exception
    // bubbles out of the submit handler.
    await waitFor(() => expect(signUp.email).toHaveBeenCalled())
  })

  it('does not call guestCredit when no guest progress was recorded', async () => {
    signUp.email.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: false } })

    render(<SignInModal onClose={vi.fn()} defaultView="sign-up" />)
    bypassSubmitDelayGuard()

    fillSignupForm({ email: 'fresh@example.com', password: 'password123' })
    fireEvent.submit(screen.getByRole('button', { name: /create account/i }).closest('form'))

    await waitFor(() => expect(signUp.email).toHaveBeenCalled())
    expect(api.guide.guestCredit).not.toHaveBeenCalled()
  })
})
