import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock socket.io-client
// ---------------------------------------------------------------------------
// We create a fresh mockSocket object for each test via a factory so spy call
// counts never bleed across tests.  The module-level _mockSocket reference
// lets us configure per-test state (e.g. connected = true).

let _mockSocket

vi.mock('socket.io-client', () => ({
  // Named export used by socket.js: `import { io } from 'socket.io-client'`
  io: vi.fn((..._args) => _mockSocket),
}))

// ---------------------------------------------------------------------------
// Reset singleton and mock socket before each test
// ---------------------------------------------------------------------------

// Because socket.js holds a module-level `_socket` singleton we must reset
// modules between tests so each test starts with _socket = null.
beforeEach(async () => {
  // Build a fresh mockSocket with cleared spies
  _mockSocket = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
    auth: {},
  }
  vi.resetModules()
})

// ---------------------------------------------------------------------------
// Helper: import socket module fresh (after resetModules)
// ---------------------------------------------------------------------------
async function importSocket() {
  // Re-apply the mock for the freshly-reset module registry
  vi.mock('socket.io-client', () => ({
    io: vi.fn((..._args) => _mockSocket),
  }))
  return import('../socket.js')
}

// ---------------------------------------------------------------------------
// getSocket
// ---------------------------------------------------------------------------

describe('getSocket', () => {
  it('returns same instance on multiple calls (singleton)', async () => {
    const { getSocket } = await importSocket()

    const s1 = getSocket()
    const s2 = getSocket()
    expect(s1).toBe(s2)
  })

  it('creates socket with autoConnect: false', async () => {
    const { getSocket } = await importSocket()
    const { io } = await import('socket.io-client')

    // Clear accumulated calls from prior tests before asserting
    io.mockClear()
    getSocket()

    expect(io).toHaveBeenCalledOnce()
    const opts = io.mock.calls[0][1]
    expect(opts).toMatchObject({ autoConnect: false })
  })
})

// ---------------------------------------------------------------------------
// connectSocket
// ---------------------------------------------------------------------------

describe('connectSocket', () => {
  it('sets auth.token on socket', async () => {
    const { connectSocket } = await importSocket()

    connectSocket('secret-token')

    expect(_mockSocket.auth).toEqual({ token: 'secret-token' })
  })

  it('calls socket.connect() when not connected', async () => {
    const { connectSocket } = await importSocket()

    _mockSocket.connected = false
    connectSocket('tok')

    expect(_mockSocket.connect).toHaveBeenCalledOnce()
  })

  it('does NOT call connect() when already connected', async () => {
    const { connectSocket } = await importSocket()

    // Mark as already connected before calling
    _mockSocket.connected = true
    connectSocket('tok')

    expect(_mockSocket.connect).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// disconnectSocket
// ---------------------------------------------------------------------------

describe('disconnectSocket', () => {
  it('calls socket.disconnect() when connected', async () => {
    const { getSocket, disconnectSocket } = await importSocket()

    // Materialise the singleton, then mark connected
    getSocket()
    _mockSocket.connected = true

    disconnectSocket()

    expect(_mockSocket.disconnect).toHaveBeenCalledOnce()
  })

  it('does nothing when not connected', async () => {
    const { getSocket, disconnectSocket } = await importSocket()

    getSocket()
    _mockSocket.connected = false

    disconnectSocket()

    expect(_mockSocket.disconnect).not.toHaveBeenCalled()
  })
})
