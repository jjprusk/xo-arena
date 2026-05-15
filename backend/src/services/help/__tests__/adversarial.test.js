// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Adversarial driver — runs each fixture from promptFixtures.js through the
 * real `ask()` generator with a stubbed chat client + stubbed db, and
 * asserts the final `done.rendered` payload contains the expected
 * substring. The intent is to pin the plumbing (prompt build → chat stream
 * → content filter → link rewrite → persistence → terminal frame) so a
 * regression in any of those stages is caught before merge.
 *
 * See doc/Help_System_Sprint_Tracker.md §2.4 for what each fixture is
 * defending against (jailbreak / hate / off-topic / grounded / no-source /
 * filter-rescue).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ADVERSARIAL_FIXTURES } from './promptFixtures.js'

async function loadServiceWithStubs({ cannedAnswer }) {
  vi.resetModules()
  vi.clearAllMocks()

  vi.doMock('../chatClient.js', () => ({
    streamChatCompletion: vi.fn(async function* () { yield cannedAnswer }),
    currentChatModelVersion: vi.fn(() => 'stub:chat'),
    RateLimitError: class extends Error {
      constructor(m, r) { super(m); this.name = 'RateLimitError'; this.retryAfter = r }
    },
  }))

  const helpQueryCreate  = vi.fn(async () => ({ id: 'q-fx' }))
  const helpQueryUpdate  = vi.fn(async () => ({}))
  const helpAnswerCreate = vi.fn(async () => ({ id: 'a-fx' }))
  vi.doMock('../../../lib/db.js', () => ({
    default: {
      systemConfig: { findUnique: vi.fn(async () => null) },
      $queryRaw:    vi.fn(async () => []),
      helpQuery:    { create: helpQueryCreate, update: helpQueryUpdate },
      helpAnswer:   { create: helpAnswerCreate },
    },
  }))
  vi.doMock('../../../logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }))

  const svc = await import('../helpService.js')
  return { svc, helpQueryCreate, helpAnswerCreate }
}

async function runFixture(fixture) {
  const { svc, helpAnswerCreate } = await loadServiceWithStubs({
    cannedAnswer: fixture.cannedAnswer,
  })
  const searchStub = vi.fn(async () => ({
    chunks: fixture.chunks,
    alpha: 0.4,
    counts: { fts: fixture.chunks.length, vec: fixture.chunks.length, merged: fixture.chunks.length },
    degraded: false,
    degradedReason: null,
  }))
  const frames = []
  for await (const f of svc.ask({
    question: fixture.question,
    userId:   'u-fx',
    _search:  searchStub,
  })) {
    frames.push(f)
  }
  const done = frames.at(-1)
  return { frames, done, helpAnswerCreate }
}

describe('adversarial fixtures (§2.4)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  for (const fixture of ADVERSARIAL_FIXTURES) {
    it(fixture.name, async () => {
      const { done, helpAnswerCreate } = await runFixture(fixture)

      expect(done.kind).toBe('done')
      expect(done.rendered).toEqual(expect.stringContaining(fixture.expectedSubstring))
      expect(done.contentFilterTriggered).toBe(fixture.expectFilterTriggered)

      // Optional second assertion: link rewriter ran on grounded answer.
      if (fixture.expectedLinkSubstring) {
        expect(done.rendered).toEqual(expect.stringContaining(fixture.expectedLinkSubstring))
      }

      // Persisted answer mirrors the rendered text — the rendered payload is
      // what users see and what the analytics layer keys off, so they must
      // stay in lockstep.
      const persistedRendered = helpAnswerCreate.mock.calls[0][0].data.rendered
      expect(persistedRendered).toBe(done.rendered)

      // Filter-trigger fixtures should record the matching terms.
      const persistedTriggered = helpAnswerCreate.mock.calls[0][0].data.contentFilterTriggered
      expect(persistedTriggered).toBe(fixture.expectFilterTriggered)
      if (fixture.expectFilterTriggered) {
        expect(helpAnswerCreate.mock.calls[0][0].data.contentFilterTerms.length)
          .toBeGreaterThan(0)
      }
    })
  }

  it('fixture data covers all five pinned categories from the spec', () => {
    // Defends the fixture file against accidental deletion / renaming.
    const names = ADVERSARIAL_FIXTURES.map(f => f.name).join('|')
    expect(names).toMatch(/jailbreak/)
    expect(names).toMatch(/hate/)
    expect(names).toMatch(/off-topic/)
    expect(names).toMatch(/grounded/)
    expect(names).toMatch(/no-source/)
  })
})
