// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * linkRewriter — convert bold platform terms into real Markdown links.
 *
 * The LLM emits `**Gym**`, `**Profile**`, `**Bot Directory**` etc. via the
 * help.v1 prompt's "Use Markdown for formatting" instruction. Today those
 * render as bold text in the UI. By post-processing the rendered Markdown
 * before persistence, we promote a curated set of platform terms to real
 * `[Term](/route)` links. The Sprint 3 HelpAnswer renderer already wraps
 * inline links with a click tracker that POSTs to /api/v1/help/feedback
 * with `implicit.docLinkClicked = true`, so this fix kicks the feedback
 * loop into gear without any UI changes.
 *
 * Design rules:
 *   - Term match is the WHOLE bold span. `**Gym**` rewrites; `**My Gym**`
 *     does not. Keeps false positives near zero.
 *   - Case-insensitive on the boldface phrase. The rendered link uses
 *     the corpus-canonical capitalisation (the LHS in LINK_MAP).
 *   - Skip if the next character is `(` — that indicates the term is
 *     already a Markdown link `[Term](url)` (defensive; the regex
 *     anchors on `**` so this is belt-and-suspenders).
 *   - Do not rewrite inside fenced code blocks. We do a simple split-on-
 *     ``` to handle that — adequate for the help corpus which has very
 *     little code.
 *
 * Term → path map is maintained here, not in the corpus. New terms get
 * added as we observe the LLM mentioning them with `**bold**` and admins
 * confirm the click-through is meaningful. Keep it short and curated;
 * over-linking is worse than under-linking (every link is a small
 * cognitive interruption for the reader).
 */

export const LINK_MAP = {
  // Order matters: multi-word terms first so they match before substring
  // single-word terms (e.g., "Bot Directory" should rewrite before "Bots",
  // "Quick Bots" before "Bots", "Tournaments" before "Tournament").
  'Bot Directory': '/bots',
  'Quick Bots':    '/bots',
  'Quick Bot':     '/bots',
  'Tournaments':   '/tournaments',
  'Tournament':    '/tournaments',
  'Cups':          '/tournaments',
  'Cup':           '/tournaments',
  'Rankings':      '/rankings',
  'Tables':        '/tables',
  'Stats':         '/stats',
  'Settings':      '/settings',
  'Profile':       '/profile',
  'Puzzles':       '/puzzles',
  'Gym':           '/gym',
  'Spar':          '/play?action=vs-community-bot',
  'Play':          '/play',
  'Bots':          '/bots',
  'FAQ':           '/faq',
}

// Build ordered alternation pattern. We escape regex metachars inside
// the term so future entries with punctuation (e.g., "Q-Learning") just
// work.
const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g
function escapeRegex(s) { return s.replace(ESCAPE_RE, '\\$&') }

const TERMS_PATTERN = Object.keys(LINK_MAP)
  .map(escapeRegex)
  .join('|')

// One-pass regex: match a platform term as a standalone word, with
// two negative-context guards:
//   1. Lookbehind `(?<![\w[])` — not preceded by a word char or `[`.
//      The `[` guard skips when the term is already inside a Markdown
//      link's display text (`[Term](url)`). Word-char guard prevents
//      matching inside compound words like "MyGym".
//   2. Lookbehind `(?<!AI Arena )` — skip when the term is part of the
//      brand phrase "AI Arena Gym", "AI Arena Tournaments", etc.
//   3. Lookahead `(?![\w]|\]\()` — not followed by word char or `](`.
//      Word-char guard prevents matching prefixes ("Gym" in "Gymnast").
//      `](` guard skips when the term is the display text of an already
//      formed Markdown link.
//
// Bold wrapping is handled implicitly: `**Gym**` matches the inner `Gym`,
// producing `**[Gym](/gym)**` — bold + linked, renders correctly. Same
// with `**Open the Gym**` → `**Open the [Gym](/gym)**`.
//
// Case-sensitive on purpose. The corpus and the LLM both use canonical
// capitalisation; rewriting lowercase "gym" in casual prose would be
// over-eager (consider "she walked into the gym" — not navigation).
//
// Two passes:
//   1. BOLD_TERM_RE matches `**Term**` (exact wrapping, whitespace-tolerant)
//      and replaces with `[Term](/route)`, stripping the bold. Per user
//      feedback (2026-05-14): links should look like links, not bold-
//      plus-link — the `→` callout + colour in HelpAnswer's CSS makes
//      the link obvious without bold.
//   2. TERM_RE matches the term as a standalone word. After pass 1, any
//      remaining `**...Term...**` is a wider bold (e.g., `**Open the
//      Gym**`); pass 2 links the inner term while leaving the bold
//      intact — graceful degradation of the user's "every bold is a
//      link" goal.
//
// Lookarounds intentionally do NOT exclude `*` so pass 2 can still link
// `Gym` inside `**Open the Gym**`. Already-linked text is excluded via
// `[` and `](`.
const BOLD_TERM_RE = new RegExp(
  `\\*\\*\\s*(${TERMS_PATTERN})\\s*\\*\\*`,
  'g',
)
const TERM_RE = new RegExp(
  `(?<![\\w\\[])(?<!AI Arena )(${TERMS_PATTERN})(?![\\w]|\\]\\()`,
  'g',
)

function pathForTerm(matchedAsWritten) {
  // Case-insensitive lookup: find the LINK_MAP key whose lowercase equals
  // the lowercase of the matched span. Return both the canonical-cased
  // term and its path.
  const lower = matchedAsWritten.toLowerCase()
  for (const [canon, path] of Object.entries(LINK_MAP)) {
    if (canon.toLowerCase() === lower) return { canon, path }
  }
  return null
}

/**
 * Rewrites platform-term mentions into Markdown links.
 *
 *   `Gym`         → `[Gym](/gym)`
 *   `**Gym**`     → `[Gym](/gym)`                 (bold stripped — link is the callout)
 *   `**Open the Gym**` → `**Open the [Gym](/gym)**`  (wider bold stays; inner term linked)
 *   `AI Arena Gym`     → unchanged                 (brand phrase)
 *   `[Gym](/gym)`      → unchanged                 (already a link)
 *   inside code fences → unchanged
 *
 * Idempotent on already-linked output.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function rewriteLinks(markdown) {
  if (typeof markdown !== 'string' || markdown.length === 0) return markdown

  // Split on triple-backtick code fences. Even-indexed segments are
  // outside fences, odd-indexed are inside. We only rewrite outside.
  const parts = markdown.split(/(```[\s\S]*?```)/g)
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) continue  // inside a fence — leave alone

    // Pass 1: `**Term**` → `[Term](/route)`, stripping the bold wrap.
    parts[i] = parts[i].replace(BOLD_TERM_RE, (_match, inner) => {
      const hit = pathForTerm(inner)
      return hit ? `[${hit.canon}](${hit.path})` : `**${inner}**`
    })

    // Pass 2: standalone `Term` → `[Term](/route)`. The TERM_RE
    // lookarounds exclude `[` (already-linked) and `*` (inside bold) so
    // this pass won't double-link the output of pass 1.
    parts[i] = parts[i].replace(TERM_RE, (match) => {
      const hit = pathForTerm(match)
      return hit ? `[${hit.canon}](${hit.path})` : match
    })
  }
  return parts.join('')
}
