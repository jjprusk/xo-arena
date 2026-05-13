// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Help System — Level 1 content filter.
 *
 * Post-stream denylist scan over the model's rendered output. Pipeline
 * integration happens in Sprint 2 (`helpService.ask`); this module ships in
 * Sprint 1 so it can be unit-tested in isolation and so the
 * `HelpAnswer.contentFilterTriggered` column has a clear contract.
 *
 * The denylist is intentionally short — slurs and worst-of-profanity only.
 * Anything subtler (jailbreaks, manipulation, bias) is the job of the prompt
 * design (role separation + XML delimiters) and the eventual Level 2
 * moderation API in v1.x. False positives here are expected and acceptable;
 * the refusal phrase is generic enough to not surface the trigger to users.
 *
 * Matching is whole-word, case-insensitive, ASCII-folded. We intentionally
 * do not maintain leetspeak / unicode-confusable variants — those belong in
 * Level 2.
 */

const DENYLIST = [
  // Slurs — these are matched as whole words. Listing them here is the only
  // way to filter them; the alternative (calling an external moderation API)
  // ships in v1.x.
  'nigger', 'nigga', 'faggot', 'tranny', 'retard', 'kike', 'chink', 'spic',
  'wetback', 'gook', 'paki', 'coon',
  // Severe profanity — milder words (damn, hell, etc.) are explicitly NOT
  // here; v1 user copy uses warm tone, not Victorian.
  'cunt', 'motherfucker',
]

// Pre-compile a single regex per term. Boundaries use \b which works for
// ASCII; this is acceptable for v1 given the English-only corpus.
const PATTERNS = DENYLIST.map(term => ({
  term,
  re: new RegExp(`\\b${term}\\b`, 'i'),
}))

/**
 * Scans `text` against the denylist.
 *
 * @param {string} text
 * @returns {{ triggered: boolean, terms: string[] }}
 */
export function scan(text) {
  const out = []
  if (!text || typeof text !== 'string') {
    return { triggered: false, terms: out }
  }
  for (const { term, re } of PATTERNS) {
    if (re.test(text)) out.push(term)
  }
  return { triggered: out.length > 0, terms: out }
}

/** Internal — exposed for tests so they can verify the denylist isn't empty. */
export function _denylistSize() {
  return DENYLIST.length
}
