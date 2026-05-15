import { describe, it, expect } from 'vitest'
import {
  buildPromptMessages,
  PROMPT_TEMPLATE_VERSION,
  REFUSAL,
  _systemMessage,
} from '../promptBuilder.js'

describe('promptBuilder', () => {
  it('exposes the current template version (help.v3)', () => {
    // help.v3 (2026-05-14) added rules 4c (greetings) and 4d (open-ended
    // platform meta-questions) so "hello" and "is this fun?" don't refuse
    // like rule 4b off-topics. Both new rules have hard length caps + a
    // no-humor / no-hyperbole constraint. Jailbreak attempts that prefix a
    // greeting still route to rule 4a. Historical HelpQuery rows from
    // help.v1/v2 remain replayable against their original templates.
    expect(PROMPT_TEMPLATE_VERSION).toBe('help.v3')
  })

  it('REFUSAL phrases are pinned and frozen', () => {
    expect(REFUSAL.EMPTY_SOURCE).toMatch(/don't have that in the docs yet/)
    expect(REFUSAL.HOSTILE).toMatch(/can't help with that/)
    expect(REFUSAL.OFF_TOPIC).toMatch(/only help you with AI Arena questions/)
    // Frozen so accidental mutation is impossible.
    expect(() => { REFUSAL.HOSTILE = 'tampered' }).toThrow()
  })

  it('system message is shared across calls (cache-friendly)', () => {
    const a = buildPromptMessages({ question: 'q', chunks: [] })
    const b = buildPromptMessages({ question: 'q2', chunks: [] })
    expect(a[0]).toBe(b[0])           // exact same reference
    expect(Object.isFrozen(a[0])).toBe(true)
  })

  it('system message instructs AI Arena branding + rules', () => {
    const sys = _systemMessage().content
    expect(sys).toMatch(/AI Arena Guide/)
    expect(sys).toMatch(/<source>/)
    expect(sys).toMatch(/<question>/)
    expect(sys).toMatch(/Keep answers under 200 words/)
    // Rule 1's refusal phrase must literally appear so the model can emit it verbatim.
    expect(sys).toContain(REFUSAL.EMPTY_SOURCE)
    expect(sys).toContain(REFUSAL.HOSTILE)
    expect(sys).toContain(REFUSAL.OFF_TOPIC)
  })

  it('user message embeds context, source, and question with XML delimiters', () => {
    const msgs = buildPromptMessages({
      question: 'how do I train a quick bot?',
      chunks: [
        { id: 'c1', content: 'Quick bots are minimax-based.' },
        { id: 'c2', content: 'They have four tiers.' },
      ],
      context: {
        route:       '/bots/training',
        currentSlot: 'guide-help',
        gameType:    'xo',
        journeyStep: 'curriculum',
      },
    })
    expect(msgs).toHaveLength(2)
    const user = msgs[1].content
    expect(user).toMatch(/Route: \/bots\/training/)
    expect(user).toMatch(/Journey step: curriculum/)
    expect(user).toMatch(/Panel slot: guide-help/)
    expect(user).toMatch(/Game: xo/)
    expect(user).toMatch(/<source>\nQuick bots are minimax-based.\n---\nThey have four tiers.\n<\/source>/)
    expect(user).toMatch(/<question>\nhow do I train a quick bot\?\n<\/question>/)
  })

  it('renders missing context fields as "(unknown)"', () => {
    const msgs = buildPromptMessages({
      question: 'q',
      chunks: [],
      context: { route: '/x' },
    })
    const user = msgs[1].content
    expect(user).toMatch(/Route: \/x/)
    expect(user).toMatch(/Journey step: \(unknown\)/)
    expect(user).toMatch(/Panel slot: \(unknown\)/)
    expect(user).toMatch(/Game: \(unknown\)/)
  })

  it('handles empty chunks (rule-1 path)', () => {
    const msgs = buildPromptMessages({ question: 'q', chunks: [] })
    const user = msgs[1].content
    expect(user).toMatch(/<source>\n\n<\/source>/)
  })

  it('skips blank chunks while joining the rest', () => {
    const msgs = buildPromptMessages({
      question: 'q',
      chunks: [
        { id: 'c1', content: 'first' },
        { id: 'c2', content: '   ' },
        { id: 'c3', content: 'third' },
      ],
    })
    const user = msgs[1].content
    expect(user).toMatch(/<source>\nfirst\n---\nthird\n<\/source>/)
  })

  it('throws for missing/blank question', () => {
    expect(() => buildPromptMessages({ question: '', chunks: [] })).toThrow(/question is required/)
    expect(() => buildPromptMessages({ question: '   ', chunks: [] })).toThrow(/question is required/)
    expect(() => buildPromptMessages({ chunks: [] })).toThrow(/question is required/)
  })

  it('throws when chunks is not an array', () => {
    expect(() => buildPromptMessages({ question: 'q', chunks: null }))
      .toThrow(/chunks must be an array/)
    expect(() => buildPromptMessages({ question: 'q', chunks: 'string' }))
      .toThrow(/chunks must be an array/)
  })

  it('does not leak user-supplied keys (e.g. userId) into the prompt', () => {
    const msgs = buildPromptMessages({
      question: 'q',
      chunks: [],
      context: {
        route:    '/x',
        userId:   'user-123',
        username: 'someone',
      },
    })
    const user = msgs[1].content
    expect(user).not.toMatch(/user-123/)
    expect(user).not.toMatch(/someone/)
    expect(user).not.toMatch(/userId/)
  })
})
