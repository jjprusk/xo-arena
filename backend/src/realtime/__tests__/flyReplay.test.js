import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getMachineId,
  mintSessionId,
  parseMachineId,
  targetMachineFor,
  sendReplay,
} from '../flyReplay.js'

const ORIGINAL_FLY_MACHINE_ID = process.env.FLY_MACHINE_ID

beforeEach(() => {
  delete process.env.FLY_MACHINE_ID
})
afterEach(() => {
  if (ORIGINAL_FLY_MACHINE_ID === undefined) delete process.env.FLY_MACHINE_ID
  else process.env.FLY_MACHINE_ID = ORIGINAL_FLY_MACHINE_ID
})

describe('flyReplay — getMachineId', () => {
  it('returns null when FLY_MACHINE_ID is unset', () => {
    expect(getMachineId()).toBeNull()
  })
  it('returns the env value when set', () => {
    process.env.FLY_MACHINE_ID = 'mA1'
    expect(getMachineId()).toBe('mA1')
  })
})

describe('flyReplay — mintSessionId', () => {
  it('returns a bare nanoid off-Fly', () => {
    const id = mintSessionId()
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(id.includes('.')).toBe(false)
    expect(id.length).toBe(16)
  })
  it('prefixes with machine id on Fly', () => {
    process.env.FLY_MACHINE_ID = 'machine123'
    const id = mintSessionId()
    expect(id.startsWith('machine123.')).toBe(true)
    expect(id.split('.')[1].length).toBe(16)
  })
  it('mints unique ids', () => {
    const a = mintSessionId()
    const b = mintSessionId()
    expect(a).not.toBe(b)
  })
})

describe('flyReplay — parseMachineId', () => {
  it('returns null for bare nanoid (no prefix)', () => {
    expect(parseMachineId('abcdef0123456789')).toBeNull()
  })
  it('returns the prefix when one is present', () => {
    expect(parseMachineId('machineX.abcdef')).toBe('machineX')
  })
  it('returns null for empty / non-string input', () => {
    expect(parseMachineId('')).toBeNull()
    expect(parseMachineId(null)).toBeNull()
    expect(parseMachineId(undefined)).toBeNull()
    expect(parseMachineId(42)).toBeNull()
  })
  it('returns null when the separator is at index 0 (malformed)', () => {
    expect(parseMachineId('.abcdef')).toBeNull()
  })
})

describe('flyReplay — targetMachineFor', () => {
  it('returns null off-Fly even when sessionId has a prefix', () => {
    expect(targetMachineFor('machineX.abcdef')).toBeNull()
  })
  it('returns null when prefix matches this machine', () => {
    process.env.FLY_MACHINE_ID = 'machineX'
    expect(targetMachineFor('machineX.abcdef')).toBeNull()
  })
  it('returns the other machine id when prefix differs', () => {
    process.env.FLY_MACHINE_ID = 'machineX'
    expect(targetMachineFor('machineY.abcdef')).toBe('machineY')
  })
  it('returns null for unprefixed (legacy) ids on Fly — fall through to local', () => {
    process.env.FLY_MACHINE_ID = 'machineX'
    expect(targetMachineFor('abcdef0123456789')).toBeNull()
  })
})

describe('flyReplay — sendReplay', () => {
  it('sets Fly-Replay header and returns 200 with json body', () => {
    const headers = {}
    let statusCode = null
    let bodyJson = null
    const res = {
      setHeader: (k, v) => { headers[k] = v },
      status: (s) => { statusCode = s; return res },
      json: (b) => { bodyJson = b; return res },
    }
    sendReplay(res, 'machineY')
    expect(headers['Fly-Replay']).toBe('instance=machineY')
    expect(statusCode).toBe(200)
    expect(bodyJson).toEqual({ replay: 'machineY' })
  })
})
