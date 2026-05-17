// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Client-side PII preview scrubber for the Research-Log publish modal.
 *
 * MIRRORS backend/src/services/research/pii.js — the server is the source
 * of truth and runs the same scrub at publish time. This client copy is for
 * the modal preview only, so the user can see what *will* be redacted
 * before confirming. If the two diverge, the server wins on publish.
 *
 * Keep these patterns in sync with the backend file when either side moves.
 */

const EMAIL = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g
const IPV4  = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
const IPV6  = /\b(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}\b|\b(?:[0-9A-Fa-f]{1,4}:){1,7}:(?:[0-9A-Fa-f]{1,4})?\b/g
const CREDIT_CARD = /\b(?:\d[ \-]?){13,19}\b/g
const PHONE_CANDIDATE = /(?:\+?\d{1,3}[ .\-]?)?(?:\(\d{1,4}\)[ .\-]?)?\d{1,4}(?:[ .\-]?\d{1,4}){1,4}/g
const STREET_SUFFIX_RE =
  /\b\d{1,6}\s+(?:[A-Z][A-Za-z'\-]*\s+){1,5}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Place|Pl|Way|Terrace|Ter|Highway|Hwy|Parkway|Pkwy)\b\.?/g

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
    const offset = args[args.length - 2]
    if (minDigits > 0 && countDigits(m) < minDigits) return m
    matches.push({ kind: label, original: m, offset })
    return `[${label} redacted]`
  })
}

export function scrubForPublishPreview(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { scrubbed: typeof text === 'string' ? text : '', matches: [] }
  }
  const matches = []
  let out = text
  out = replaceAll(out, EMAIL, 'email', matches)
  out = replaceAll(out, IPV6,  'ipv6',  matches)
  out = replaceAll(out, IPV4,  'ipv4',  matches)
  out = replaceAll(out, CREDIT_CARD, 'card', matches, { minDigits: 13 })
  out = replaceAll(out, STREET_SUFFIX_RE, 'address', matches)
  out = replaceAll(out, PHONE_CANDIDATE,  'phone', matches, { minDigits: 7 })
  return { scrubbed: out, matches }
}
