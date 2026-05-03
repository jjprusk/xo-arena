// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Compute the effective `recurrenceEndDate` for a tournament template
 * (Guard C). When the caller did not provide one and the template is
 * flagged `isTest=true`, default to anchor + 24h so a leaked test
 * template self-expires even if the spec never reaches cleanup.
 *
 * Inputs:
 *   anchor       — the template's recurrenceStart (Date, required).
 *   isTest       — boolean flag from the request body.
 *   providedEnd  — what the caller passed (Date | undefined | null).
 *
 * Returns: Date | undefined. Caller spreads `recurrenceEndDate` only if
 * the result is defined, so we don't overwrite the column with null.
 */
export const TEST_TEMPLATE_TTL_MS = 24 * 60 * 60 * 1000

export function computeTemplateEndDate(anchor, isTest, providedEnd) {
  if (providedEnd) return providedEnd
  if (isTest && anchor) return new Date(anchor.getTime() + TEST_TEMPLATE_TTL_MS)
  return undefined
}
