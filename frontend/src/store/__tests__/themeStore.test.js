import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useThemeStore } from '../themeStore.js'

describe('themeStore', () => {
  beforeEach(() => {
    // Reset to light
    useThemeStore.setState({ theme: 'light' })
    document.documentElement.classList.remove('dark')
  })

  it('defaults to light theme', () => {
    expect(useThemeStore.getState().theme).toBe('light')
  })

  it('setTheme updates theme', () => {
    useThemeStore.getState().setTheme('dark')
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('setTheme dark adds .dark class to html', () => {
    useThemeStore.getState().setTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('setTheme light removes .dark class', () => {
    document.documentElement.classList.add('dark')
    useThemeStore.getState().setTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
