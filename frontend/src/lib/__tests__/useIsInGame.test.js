import { describe, it, expect, beforeEach } from 'vitest'
import { useGameStore } from '../../store/gameStore.js'
import { usePvpStore } from '../../store/pvpStore.js'
import { useIsInGame } from '../useIsInGame.js'
import { renderHook } from '@testing-library/react'

beforeEach(() => {
  useGameStore.getState().newGame()
  usePvpStore.getState().reset()
})

describe('useIsInGame', () => {
  it('returns false when both stores are idle', () => {
    const { result } = renderHook(() => useIsInGame())
    expect(result.current).toBe(false)
  })

  it('returns true when hva game is playing', () => {
    useGameStore.setState({ status: 'playing' })
    const { result } = renderHook(() => useIsInGame())
    expect(result.current).toBe(true)
  })

  it('returns true when hvh game is playing', () => {
    usePvpStore.setState({ status: 'playing' })
    const { result } = renderHook(() => useIsInGame())
    expect(result.current).toBe(true)
  })

  it('returns false when hva game is won (not playing)', () => {
    useGameStore.setState({ status: 'won' })
    const { result } = renderHook(() => useIsInGame())
    expect(result.current).toBe(false)
  })

  it('returns false when hvh game is finished (not playing)', () => {
    usePvpStore.setState({ status: 'finished' })
    const { result } = renderHook(() => useIsInGame())
    expect(result.current).toBe(false)
  })

  it('returns true when both stores are playing', () => {
    useGameStore.setState({ status: 'playing' })
    usePvpStore.setState({ status: 'playing' })
    const { result } = renderHook(() => useIsInGame())
    expect(result.current).toBe(true)
  })
})
