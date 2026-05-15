import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  streamChatCompletion,
  health,
  RateLimitError,
  CHAT_MODEL_VERSION_LIVE,
  CHAT_MODEL_VERSION_STUB,
  currentChatProvider,
  currentChatModelVersion,
} from '../chatClient.js'

async function collect(generator) {
  const out = []
  for await (const piece of generator) out.push(piece)
  return out
}

describe('chatClient — version + provider helpers', () => {
  it('currentChatProvider defaults to openai', () => {
    const orig = process.env.HELP_CHAT_PROVIDER
    delete process.env.HELP_CHAT_PROVIDER
    try {
      expect(currentChatProvider()).toBe('openai')
    } finally {
      if (orig !== undefined) process.env.HELP_CHAT_PROVIDER = orig
    }
  })

  it('currentChatModelVersion returns stub tag under vitest', () => {
    expect(currentChatModelVersion()).toBe(CHAT_MODEL_VERSION_STUB)
  })
})

describe('chatClient — stub mode', () => {
  it('yields a deterministic short answer without calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const pieces = await collect(streamChatCompletion([
      { role: 'system', content: 'sys' },
      { role: 'user',   content: 'q' },
    ]))
    expect(pieces.length).toBeGreaterThan(0)
    expect(pieces.join('')).toMatch(/stub/i)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('rejects empty messages array', async () => {
    await expect(collect(streamChatCompletion([]))).rejects.toThrow(/messages must be a non-empty/)
  })

  it('health() returns ok in stub mode without network', async () => {
    const h = await health()
    expect(h.ok).toBe(true)
    expect(h.provider).toBe('stub')
  })
})

describe('chatClient — OpenAI path', () => {
  let fetchSpy
  let origEnv
  let origVitest
  let origKey
  let origProvider

  beforeEach(() => {
    origEnv      = process.env.NODE_ENV
    origVitest   = process.env.VITEST
    origKey      = process.env.OPENAI_API_KEY
    origProvider = process.env.HELP_CHAT_PROVIDER
    process.env.NODE_ENV = 'development'
    delete process.env.VITEST
    process.env.OPENAI_API_KEY = 'sk-test-fake-key'
    delete process.env.HELP_CHAT_PROVIDER  // → defaults to 'openai'
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    process.env.NODE_ENV = origEnv
    if (origVitest === undefined) delete process.env.VITEST
    else process.env.VITEST = origVitest
    if (origKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = origKey
    if (origProvider === undefined) delete process.env.HELP_CHAT_PROVIDER
    else process.env.HELP_CHAT_PROVIDER = origProvider
    fetchSpy.mockRestore()
  })

  function sseBodyFrom(pieces) {
    // Mock a ReadableStream-like async iterable matching what fetch().body
    // looks like in modern node (Web Streams). The chatClient consumes it
    // with `for await (const chunk of res.body)`.
    const frames = []
    for (const text of pieces) {
      const payload = JSON.stringify({ choices: [{ delta: { content: text } }] })
      frames.push(`data: ${payload}\n\n`)
    }
    frames.push(`data: [DONE]\n\n`)
    return {
      async *[Symbol.asyncIterator]() {
        for (const f of frames) yield Buffer.from(f, 'utf8')
      },
    }
  }

  it('happy path: streams content fragments', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: sseBodyFrom(['Hello ', 'world', '.']),
      text: async () => '',
      headers: new Headers(),
    })
    const out = await collect(streamChatCompletion([
      { role: 'system', content: 'sys' },
      { role: 'user',   content: 'q' },
    ]))
    expect(out).toEqual(['Hello ', 'world', '.'])
    const call = fetchSpy.mock.calls[0]
    expect(call[0]).toBe('https://api.openai.com/v1/chat/completions')
    const body = JSON.parse(call[1].body)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.stream).toBe(true)
    expect(body.max_tokens).toBe(400)
    expect(call[1].headers.Authorization).toBe('Bearer sk-test-fake-key')
  })

  it('respects custom maxTokens', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true, status: 200,
      body: sseBodyFrom(['x']),
      text: async () => '', headers: new Headers(),
    })
    await collect(streamChatCompletion(
      [{ role: 'user', content: 'q' }],
      { maxTokens: 100 },
    ))
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).max_tokens).toBe(100)
  })

  it('throws RateLimitError on 429 with retryAfter', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false, status: 429,
      text: async () => '{"error":"rate"}',
      headers: new Headers({ 'retry-after': '7' }),
    })
    await expect(collect(streamChatCompletion(
      [{ role: 'user', content: 'q' }],
    ))).rejects.toMatchObject({ name: 'RateLimitError', retryAfter: 7 })
  })

  it('throws on 5xx with status in message (after retries exhaust)', async () => {
    // fetchWithRetry retries 5xx; mock has to persist across all attempts.
    fetchSpy.mockResolvedValue({
      ok: false, status: 503,
      text: async () => 'unavailable',
      headers: new Headers(),
    })
    await expect(collect(streamChatCompletion(
      [{ role: 'user', content: 'q' }],
    ))).rejects.toThrow(/openai chat 503/)
  }, 10_000)

  it('throws if OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY
    await expect(collect(streamChatCompletion(
      [{ role: 'user', content: 'q' }],
    ))).rejects.toThrow(/OPENAI_API_KEY missing/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('throws "provider not built" for non-openai providers', async () => {
    process.env.HELP_CHAT_PROVIDER = 'groq'
    await expect(collect(streamChatCompletion(
      [{ role: 'user', content: 'q' }],
    ))).rejects.toThrow(/provider not built — groq/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('skips malformed SSE frames gracefully', async () => {
    const frames = [
      `data: {malformed json\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`,
      `data: [DONE]\n\n`,
    ]
    fetchSpy.mockResolvedValueOnce({
      ok: true, status: 200,
      body: {
        async *[Symbol.asyncIterator]() {
          for (const f of frames) yield Buffer.from(f, 'utf8')
        },
      },
      text: async () => '', headers: new Headers(),
    })
    const out = await collect(streamChatCompletion(
      [{ role: 'user', content: 'q' }],
    ))
    expect(out).toEqual(['ok'])
  })

  it('terminates on [DONE] sentinel', async () => {
    const frames = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'A' } }] })}\n\n`,
      `data: [DONE]\n\n`,
      // Anything after [DONE] must be ignored.
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'B' } }] })}\n\n`,
    ]
    fetchSpy.mockResolvedValueOnce({
      ok: true, status: 200,
      body: {
        async *[Symbol.asyncIterator]() {
          for (const f of frames) yield Buffer.from(f, 'utf8')
        },
      },
      text: async () => '', headers: new Headers(),
    })
    const out = await collect(streamChatCompletion(
      [{ role: 'user', content: 'q' }],
    ))
    expect(out).toEqual(['A'])
  })

  it('currentChatModelVersion returns live tag in live mode', () => {
    expect(currentChatModelVersion()).toBe(CHAT_MODEL_VERSION_LIVE)
  })

  it('health() returns ok on streamed reply', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true, status: 200,
      body: sseBodyFrom(['ok']),
      text: async () => '', headers: new Headers(),
    })
    const h = await health()
    expect(h.ok).toBe(true)
    expect(h.provider).toBe('openai')
    expect(h.model).toBe('gpt-4o-mini')
  })

  it('health() returns ok=false with error on failure (never throws)', async () => {
    fetchSpy.mockResolvedValue({
      ok: false, status: 500,
      text: async () => 'boom', headers: new Headers(),
    })
    const h = await health()
    expect(h.ok).toBe(false)
    expect(h.error).toMatch(/openai chat 500/)
  }, 10_000)
})
