import { describe, it, expect } from 'vitest'
import { rewriteLinks, LINK_MAP } from '../linkRewriter.js'

describe('linkRewriter', () => {
  it('rewrites a single bold term — bold preserved, link added inside', () => {
    const out = rewriteLinks('Head to the **Gym** to train.')
    expect(out).toBe('Head to the **[Gym](/gym)** to train.')
  })

  it('rewrites all known terms in a single pass', () => {
    const input = 'From the **Gym** or your **Profile**, open the **Bot Directory** and visit **Settings**.'
    const out = rewriteLinks(input)
    expect(out).toBe('From the **[Gym](/gym)** or your **[Profile](/profile)**, open the **[Bot Directory](/bots)** and visit **[Settings](/settings)**.')
  })

  // Case-insensitive matching was removed (one-pass approach is case
  // sensitive on purpose; the corpus and LLM both use canonical caps).
  it('does NOT rewrite lowercase casual prose', () => {
    const out = rewriteLinks('she walked into the gym today')
    expect(out).toBe('she walked into the gym today')
  })

  it('links the inner term inside a longer bold span', () => {
    // Bold is preserved; the platform term gets a link.
    const out = rewriteLinks('My **Custom Gym** has bots.')
    expect(out).toBe('My **Custom [Gym](/gym)** has bots.')
  })

  it('links the inner term inside a bold step heading', () => {
    // Realistic LLM-style heading.
    const out = rewriteLinks('1. **Open the Gym**: train your bots.')
    expect(out).toBe('1. **Open the [Gym](/gym)**: train your bots.')
  })

  it('does NOT rewrite "Gym" inside "AI Arena Gym" (lookbehind guard)', () => {
    const out = rewriteLinks('Welcome to AI Arena Gym, where bots learn.')
    expect(out).toBe('Welcome to AI Arena Gym, where bots learn.')  // unchanged
  })

  it('links a plain standalone capitalised term', () => {
    const out = rewriteLinks('Head to Gym to start training.')
    expect(out).toBe('Head to [Gym](/gym) to start training.')
  })

  it('does NOT link lowercase term in casual prose', () => {
    const out = rewriteLinks('the gym was unavailable')
    expect(out).toBe('the gym was unavailable')  // unchanged
  })

  it('does NOT double-link a term that is already a Markdown link', () => {
    const input = 'Open [Gym](/gym) to play.'
    expect(rewriteLinks(input)).toBe(input)
  })

  it('does NOT rewrite unknown terms', () => {
    const out = rewriteLinks('Open **Marketplace** to buy stuff.')
    expect(out).toBe('Open **Marketplace** to buy stuff.')  // unchanged
  })

  it('handles multi-word terms before single-word substrings', () => {
    // "Bot Directory" appears in LINK_MAP before "Bots", so we should NOT
    // see "**Bot** Directory" being half-rewritten.
    const out = rewriteLinks('Open the **Bot Directory** to browse.')
    expect(out).toBe('Open the **[Bot Directory](/bots)** to browse.')
  })

  it('leaves fenced code blocks untouched', () => {
    const input = '```\nclick **Gym** to play\n```\nThen visit **Gym**.'
    const out = rewriteLinks(input)
    // Inside the fence: unchanged. Outside: rewritten.
    expect(out).toBe('```\nclick **Gym** to play\n```\nThen visit **[Gym](/gym)**.')
  })

  it('is idempotent on already-linked output', () => {
    const once = rewriteLinks('Open the **Gym**.')
    const twice = rewriteLinks(once)
    expect(twice).toBe(once)
    expect(twice).toBe('Open the **[Gym](/gym)**.')
  })

  it('handles plural terms registered in LINK_MAP (Bots, Tables, Rankings)', () => {
    const out = rewriteLinks('See **Bots**, **Tables**, **Rankings**.')
    expect(out).toBe('See **[Bots](/bots)**, **[Tables](/tables)**, **[Rankings](/rankings)**.')
  })

  it('returns input untouched when no terms present', () => {
    const input = 'A normal paragraph with **emphasis** but no platform terms.'
    expect(rewriteLinks(input)).toBe(input)
  })

  it('handles empty and non-string input safely', () => {
    expect(rewriteLinks('')).toBe('')
    expect(rewriteLinks(null)).toBe(null)
    expect(rewriteLinks(undefined)).toBe(undefined)
  })

  it('handles a realistic LLM-style response', () => {
    const input = [
      'To play tic-tac-toe on AI Arena:',
      '1. Open **Tables** and create a new table.',
      '2. Select XO as the game.',
      '3. Visit your **Profile** to track your wins.',
      'You can also train bots in the **Gym** or browse opponents in the **Bot Directory**.',
    ].join('\n')
    const out = rewriteLinks(input)
    expect(out).toContain('[Tables](/tables)')
    expect(out).toContain('[Profile](/profile)')
    expect(out).toContain('[Gym](/gym)')
    expect(out).toContain('[Bot Directory](/bots)')
    // Bold wrapping is preserved (it's now `**[Tables](/tables)**`).
    expect(out).toContain('**[Tables](/tables)**')
  })

  it('helpful "AI Arena Gym" exception remains intact even with bold', () => {
    // The lookbehind only blocks the plain "AI Arena Gym" phrase; if the
    // model bolds the whole brand mention as **AI Arena Gym**, the
    // lookbehind sees "[" after "**", so we still skip. (Edge case but
    // worth pinning.)
    const out = rewriteLinks('Welcome to **AI Arena Gym**.')
    // Inside the bold, "Gym" is preceded by " " (space after "Arena"). Our
    // lookbehind `(?<!AI Arena )` matches this case and skips. Good.
    expect(out).toBe('Welcome to **AI Arena Gym**.')
  })

  it('LINK_MAP exposes the term→path map for inspection', () => {
    expect(typeof LINK_MAP).toBe('object')
    expect(LINK_MAP.Gym).toBe('/gym')
    expect(LINK_MAP['Bot Directory']).toBe('/bots')
  })
})
