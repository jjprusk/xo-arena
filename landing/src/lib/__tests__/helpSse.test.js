// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, vi } from 'vitest'
import { streamHelpAsk } from '../helpSse.js'

/**
 * Build a mock fetch that returns a Response-shaped object whose `body`
 * is a ReadableStream emitting the given chunks (one per "tick"). Each
 * chunk is a string; we encode to Uint8Array internally.
 */
function makeSseResponse({ status = 200, headers = {}, chunks = [], delayMs = 0 }) {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    async start(controller) {
      for (const c of chunks) {
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
        controller.enqueue(encoder.encode(c))
      }
      controller.close()
    },
  })
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    body,
    async json() {
      // Drain the stream and try to parse — only realistic for non-stream errors.
      const reader = body.getReader()
      let text = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        text += new TextDecoder().decode(value)
      }
      try { return JSON.parse(text) } catch { return {} }
    },
  }
}

function jsonBodyResponse({ status = 200, body = {} }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    body: null,
    async json() { return body },
  }
}

async function collect(asyncIter) {
  const out = []
  for await (const f of asyncIter) out.push(f)
  return out
}

describe('streamHelpAsk — happy path', () => {
  it('yields token frames followed by a done frame', async () => {
    const fetcher = vi.fn(async () => makeSseResponse({
      chunks: [
        'event: token\ndata: {"text":"Hello "}\n\n',
        'event: token\ndata: {"text":"world."}\n\n',
        'event: done\ndata: {"answerId":"a-1","queryId":"q-1","rendered":"Hello world.","contentFilterTriggered":false,"degraded":false,"latencyMs":42}\n\n',
      ],
    }))
    const frames = await collect(streamHelpAsk({
      question: 'q', token: 't', fetcher, baseUrl: 'http://x',
    }))
    expect(frames).toEqual([
      { kind: 'token', text: 'Hello ' },
      { kind: 'token', text: 'world.' },
      {
        kind: 'done',
        answerId: 'a-1',
        queryId:  'q-1',
        rendered: 'Hello world.',
        contentFilterTriggered: false,
        degraded: false,
        latencyMs: 42,
        citations: [],
      },
    ])
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('http://x/api/v1/help/ask')
    expect(init.method).toBe('POST')
    expect(init.headers['Authorization']).toBe('Bearer t')
    expect(JSON.parse(init.body)).toEqual({ question: 'q', context: {} })
  })

  it('handles tokens arriving split across reader chunks (partial SSE blocks)', async () => {
    // The token frame is split mid-string across two reads — the parser
    // must buffer the partial block.
    const fetcher = vi.fn(async () => makeSseResponse({
      chunks: [
        'event: tok',
        'en\ndata: {"text":"Hello"}\n\nevent: done\ndata: {"answerId":"a","queryId":"q","rendered":"Hello","contentFilterTriggered":false,"degraded":false,"latencyMs":1}\n\n',
      ],
    }))
    const frames = await collect(streamHelpAsk({ question: 'q', fetcher, baseUrl: '' }))
    expect(frames[0]).toEqual({ kind: 'token', text: 'Hello' })
    expect(frames[1].kind).toBe('done')
  })

  it('passes context through unchanged in the POST body', async () => {
    let captured
    const fetcher = vi.fn(async (_url, init) => {
      captured = JSON.parse(init.body)
      return makeSseResponse({ chunks: ['event: done\ndata: {"rendered":""}\n\n'] })
    })
    await collect(streamHelpAsk({
      question: 'q',
      context:  { route: '/play', gameType: 'xo' },
      fetcher, baseUrl: '',
    }))
    expect(captured.context).toEqual({ route: '/play', gameType: 'xo' })
  })

  it('sends X-Internal-Secret when provided and omits Authorization', async () => {
    const fetcher = vi.fn(async () => makeSseResponse({
      chunks: ['event: done\ndata: {"rendered":""}\n\n'],
    }))
    await collect(streamHelpAsk({
      question: 'q', internalSecret: 'shh', fetcher, baseUrl: '',
    }))
    const init = fetcher.mock.calls[0][1]
    expect(init.headers['X-Internal-Secret']).toBe('shh')
    expect(init.headers['Authorization']).toBeUndefined()
  })
})

describe('streamHelpAsk — terminal error frames pass through', () => {
  it('forwards a server-emitted error frame as a single terminal frame', async () => {
    const fetcher = vi.fn(async () => makeSseResponse({
      chunks: [
        'event: error\ndata: {"error":"llm_unavailable"}\n\n',
      ],
    }))
    const frames = await collect(streamHelpAsk({ question: 'q', fetcher, baseUrl: '' }))
    expect(frames).toEqual([
      { kind: 'error', error: 'llm_unavailable', source: 'server', retryAfter: null, detail: null },
    ])
  })

  it('forwards rate-limited error frame with retryAfter', async () => {
    const fetcher = vi.fn(async () => makeSseResponse({
      chunks: [
        'event: error\ndata: {"error":"rate_limited","source":"provider","retryAfter":5}\n\n',
      ],
    }))
    const frames = await collect(streamHelpAsk({ question: 'q', fetcher, baseUrl: '' }))
    expect(frames[0]).toEqual({
      kind: 'error', error: 'rate_limited', source: 'provider', retryAfter: 5, detail: null,
    })
  })
})

describe('streamHelpAsk — HTTP-level errors before stream open', () => {
  it('401 → error=auth_required', async () => {
    const fetcher = vi.fn(async () => jsonBodyResponse({ status: 401, body: { error: 'Authentication required' } }))
    const frames = await collect(streamHelpAsk({ question: 'q', fetcher, baseUrl: '' }))
    expect(frames).toEqual([{ kind: 'error', error: 'auth_required', status: 401 }])
  })

  it('429 → error=rate_limited with retryAfter and scope from body', async () => {
    const fetcher = vi.fn(async () => jsonBodyResponse({
      status: 429, body: { error: 'rate_limited', retryAfter: 7, scope: 'minute' },
    }))
    const frames = await collect(streamHelpAsk({ question: 'q', fetcher, baseUrl: '' }))
    expect(frames).toEqual([{
      kind: 'error', error: 'rate_limited', source: 'app', retryAfter: 7, scope: 'minute', status: 429,
    }])
  })

  it('400 → error=invalid_request', async () => {
    const fetcher = vi.fn(async () => jsonBodyResponse({ status: 400, body: { error: 'invalid_request' } }))
    const frames = await collect(streamHelpAsk({ question: 'q', fetcher, baseUrl: '' }))
    expect(frames[0]).toMatchObject({ kind: 'error', error: 'invalid_request', status: 400 })
  })

  it('5xx → error=http_<status>', async () => {
    const fetcher = vi.fn(async () => ({
      ok: false, status: 502, headers: new Headers(), body: null,
      async json() { return {} },
    }))
    const frames = await collect(streamHelpAsk({ question: 'q', fetcher, baseUrl: '' }))
    expect(frames[0]).toEqual({ kind: 'error', error: 'http_502', status: 502 })
  })

  it('network failure → error=network', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('boom') })
    const frames = await collect(streamHelpAsk({ question: 'q', fetcher, baseUrl: '' }))
    expect(frames[0]).toMatchObject({ kind: 'error', error: 'network' })
  })
})

describe('streamHelpAsk — guards', () => {
  it('returns empty_question error for blank input (does not call fetch)', async () => {
    const fetcher = vi.fn()
    const frames = await collect(streamHelpAsk({ question: '   ', fetcher, baseUrl: '' }))
    expect(frames).toEqual([{ kind: 'error', error: 'empty_question' }])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns no_fetch error when fetcher is not callable', async () => {
    const frames = await collect(streamHelpAsk({ question: 'q', fetcher: null, baseUrl: '' }))
    expect(frames).toEqual([{ kind: 'error', error: 'no_fetch' }])
  })

  it('emits aborted error when the AbortSignal fires during fetch open', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async (_url, _init) => {
      const e = new Error('aborted')
      e.name = 'AbortError'
      throw e
    })
    controller.abort()
    const frames = await collect(streamHelpAsk({
      question: 'q', fetcher, baseUrl: '', signal: controller.signal,
    }))
    expect(frames).toEqual([{ kind: 'error', error: 'aborted' }])
  })

  it('emits incomplete_stream when server closes without done/error frame', async () => {
    const fetcher = vi.fn(async () => makeSseResponse({
      chunks: ['event: token\ndata: {"text":"hi"}\n\n'],   // no terminal frame
    }))
    const frames = await collect(streamHelpAsk({ question: 'q', fetcher, baseUrl: '' }))
    expect(frames.at(-1)).toEqual({ kind: 'error', error: 'incomplete_stream' })
  })

  it('ignores unknown event names without crashing', async () => {
    const fetcher = vi.fn(async () => makeSseResponse({
      chunks: [
        'event: progress\ndata: {"step":1}\n\n',
        'event: token\ndata: {"text":"ok"}\n\n',
        'event: done\ndata: {"rendered":"ok"}\n\n',
      ],
    }))
    const frames = await collect(streamHelpAsk({ question: 'q', fetcher, baseUrl: '' }))
    // progress is dropped silently; we keep the token + done.
    expect(frames).toEqual([
      { kind: 'token', text: 'ok' },
      { kind: 'done', answerId: null, queryId: null, rendered: 'ok', contentFilterTriggered: false, degraded: false, latencyMs: null, citations: [] },
    ])
  })
})
