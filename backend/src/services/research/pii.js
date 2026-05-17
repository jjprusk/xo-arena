// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * PII scrubber for Research Log community-published notes/entries.
 *
 * Sprint 2 of doc/Research_Log_Plan.md §2.3.
 *
 * Strips: emails, phone numbers (loose international), IPv4 / IPv6,
 * US-style street addresses (rough), credit-card-shaped digit runs.
 *
 * Personal-name detection is intentionally **NOT** attempted in v1 —
 * too high a false-positive rate. The publish modal shows a side-by-side
 * preview so the user can spot any names before confirming.
 *
 * The output is the same string with each match replaced by a labelled
 * placeholder (e.g. `[email redacted]`). Match metadata is returned
 * alongside so the modal can highlight the swaps for review.
 */

// ── Patterns ───────────────────────────────────────────────────────────────

// Email: word-ish local + @ + domain with at least one dot. Anchored loose
// enough to catch `joe.smith+tag@example.co.uk`.
const EMAIL = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g

// IPv4: four 1–3 digit groups separated by dots, with a word boundary on each side.
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g

// IPv6: 8 groups of 1–4 hex chars OR a `::` compressed form.
// Loose match — sufficient for scrubbing, not for validation.
const IPV6 = /\b(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}\b|\b(?:[0-9A-Fa-f]{1,4}:){1,7}:(?:[0-9A-Fa-f]{1,4})?\b/g

// Credit-card-shaped: 13–19 digits with optional spaces or dashes between groups.
// Required to span ≥13 digits total to avoid catching long zero-padded numerics.
const CREDIT_CARD = /\b(?:\d[ \-]?){13,19}\b/g

// Phone: loose international — optional +, then digits / spaces / dashes /
// parens / dots, must contain at least 7 digits total. We match the candidate
// span first, then count digits to confirm.
const PHONE_CANDIDATE = /(?:\+?\d{1,3}[ .\-]?)?(?:\(\d{1,4}\)[ .\-]?)?\d{1,4}(?:[ .\-]?\d{1,4}){1,4}/g

// US street address: <number> <word>(s) <suffix> — case-insensitive suffix list.
const STREET_SUFFIX_RE =
  /\b\d{1,6}\s+(?:[A-Z][A-Za-z'\-]*\s+){1,5}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Place|Pl|Way|Terrace|Ter|Highway|Hwy|Parkway|Pkwy)\b\.?/g

// ── Helpers ────────────────────────────────────────────────────────────────

function countDigits(s) {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 48 && c <= 57) n++
  }
  return n
}

function replaceAll(text, regex, label, matches, opts = {}) {
  const minDigits = opts.minDigits ?? 0
  return text.replace(regex, (m, ...args) => {
    // args[args.length - 2] is the match index (per String.replace contract).
    const offset = args[args.length - 2]
    if (minDigits > 0 && countDigits(m) < minDigits) return m
    matches.push({ kind: label, original: m, offset })
    return `[${label} redacted]`
  })
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * @param {string} text  Raw note/entry body.
 * @returns {{ scrubbed: string, matches: Array<{kind: string, original: string, offset: number}> }}
 */
export function scrubForPublish(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { scrubbed: typeof text === 'string' ? text : '', matches: [] }
  }

  const matches = []
  let out = text

  // Order matters — strip the most specific patterns first so a later loose
  // regex doesn't fragment a longer match. Emails before phones (an email
  // contains digits the phone regex would otherwise eat); credit cards before
  // phones (both are digit-heavy); IPv6 before IPv4 (IPv6 contains :: which
  // IPv4 ignores, but the hex groups can confuse the phone matcher).
  out = replaceAll(out, EMAIL, 'email', matches)
  out = replaceAll(out, IPV6, 'ipv6', matches)
  out = replaceAll(out, IPV4, 'ipv4', matches)
  out = replaceAll(out, CREDIT_CARD, 'card', matches, { minDigits: 13 })
  out = replaceAll(out, STREET_SUFFIX_RE, 'address', matches)
  out = replaceAll(out, PHONE_CANDIDATE, 'phone', matches, { minDigits: 7 })

  return { scrubbed: out, matches }
}
