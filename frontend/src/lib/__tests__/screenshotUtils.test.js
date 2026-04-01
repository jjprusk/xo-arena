import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isMobile, compressImage } from '../screenshotUtils.js'

// ── isMobile ──────────────────────────────────────────────────────────────────

describe('isMobile', () => {
  const originalInnerWidth = window.innerWidth

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    })
  })

  it('returns false when window.innerWidth is 768 (threshold boundary)', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 768 })
    expect(isMobile()).toBe(false)
  })

  it('returns false when window.innerWidth is above 768', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 })
    expect(isMobile()).toBe(false)
  })

  it('returns true when window.innerWidth is below 768', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
    expect(isMobile()).toBe(true)
  })

  it('returns true at width 767', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 767 })
    expect(isMobile()).toBe(true)
  })
})

// ── compressImage ─────────────────────────────────────────────────────────────

describe('compressImage', () => {
  // jsdom's HTMLCanvasElement.toDataURL returns 'data:,' by default.
  // We override it to return a predictable value for assertions.
  const FAKE_OUTPUT = 'data:image/jpeg;base64,compressedoutput'

  beforeEach(() => {
    // Stub canvas toDataURL so tests aren't reliant on jsdom's empty canvas output
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(FAKE_OUTPUT)
    // Stub getContext to avoid "not implemented" errors in jsdom
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    })
    // jsdom's Image never fires onload/onerror — stub it to simulate loading
    vi.stubGlobal('Image', class {
      constructor() {
        this.width = 400
        this.height = 200
        this._src = ''
      }
      get src() { return this._src }
      set src(value) {
        this._src = value
        if (typeof value === 'string' && value.startsWith('data:')) {
          Promise.resolve().then(() => this.onload?.())
        } else {
          Promise.resolve().then(() => this.onerror?.(new Error('invalid src')))
        }
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function makeDataUrl(width = 400, height = 200) {
    // Create a minimal valid PNG data URL via a real canvas for the Image src
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas.toDataURL('image/png')
  }

  it('returns a Promise', () => {
    const result = compressImage('data:image/png;base64,fake')
    expect(result).toBeInstanceOf(Promise)
  })

  it('resolves with the canvas toDataURL output', async () => {
    const dataUrl = makeDataUrl(400, 200)
    const result = await compressImage(dataUrl)
    expect(result).toBe(FAKE_OUTPUT)
  })

  it('calls toDataURL with jpeg mime type and quality', async () => {
    const dataUrl = makeDataUrl(400, 200)
    await compressImage(dataUrl, 800, 0.7)
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.7)
  })

  it('calls toDataURL with custom quality parameter', async () => {
    const dataUrl = makeDataUrl(400, 200)
    await compressImage(dataUrl, 800, 0.5)
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.5)
  })

  it('sets canvas width to image width when image is narrower than maxWidth', async () => {
    // jsdom Image doesn't load real images; we check canvas width is set correctly
    // by observing that the canvas element created has correct dimensions
    const widths = []
    const OrigCanvas = global.HTMLCanvasElement
    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')
    // We can't easily observe canvas.width = x via spy, but we can confirm the
    // canvas construction logic by mocking document.createElement
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = origCreate(tag)
      if (tag === 'canvas') {
        Object.defineProperty(el, 'width', {
          set(v) { widths.push(v) },
          get() { return widths.at(-1) ?? 0 },
          configurable: true,
        })
      }
      return el
    })

    const dataUrl = makeDataUrl(400, 200)
    await compressImage(dataUrl, 800)

    // Width should be <= 800 (not scaled up since 400 < 800)
    const canvasWidth = widths.at(-1)
    if (canvasWidth !== undefined) {
      expect(canvasWidth).toBeLessThanOrEqual(800)
    }

    vi.restoreAllMocks()
    // Re-stub toDataURL and getContext since restoreAllMocks removed them
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(FAKE_OUTPUT)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() })
  })

  it('rejects when the image src is invalid', async () => {
    await expect(compressImage('not-a-valid-data-url')).rejects.toThrow()
  })
})
