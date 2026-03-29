/**
 * Rule-Based AI Implementation
 *
 * Plays using a named RuleSet stored in the database.  Rules are evaluated in
 * priority order; the first applicable enabled rule wins.  Falls back to a
 * random legal move if no rule matches (should never happen in practice).
 *
 * Rule sets are loaded once and cached in memory.
 */

import db from '../lib/db.js'
import { getEmptyCells, applyRule } from '@xo-arena/ai'

/** In-memory cache: ruleSetId → rules array (sorted by priority, enabled only) */
const ruleSetCache = new Map()

/** Invalidate a cached rule set (call after DB update). */
export function invalidateRuleSetCache(ruleSetId) {
  ruleSetCache.delete(ruleSetId)
}

async function loadRules(ruleSetId) {
  if (ruleSetCache.has(ruleSetId)) return ruleSetCache.get(ruleSetId)

  const rs = await db.ruleSet.findUnique({ where: { id: ruleSetId } })
  if (!rs) throw new Error(`RuleSet ${ruleSetId} not found`)

  const rules = (rs.rules || [])
    .filter(r => r.enabled !== false)
    .sort((a, b) => a.priority - b.priority)

  ruleSetCache.set(ruleSetId, rules)
  return rules
}

/**
 * Main move function.
 * Signature matches the registry interface: (board, difficulty, player, ruleSetId)
 */
export async function ruleBasedMove(board, _difficulty, player, ruleSetId) {
  if (!ruleSetId) {
    // No rule set specified — random fallback
    const empty = getEmptyCells(board)
    return empty[Math.floor(Math.random() * empty.length)]
  }

  const rules = await loadRules(ruleSetId)

  for (const rule of rules) {
    const move = applyRule(board, player, rule.id)
    if (move !== null) return move
  }

  // Fallback: random move (all rules were inapplicable)
  const empty = getEmptyCells(board)
  return empty[Math.floor(Math.random() * empty.length)]
}

export const ruleBasedImplementation = {
  id: 'rule_based',
  name: 'Rule-Based',
  description: 'Plays using ML-extracted IF-THEN rules. Select a Rule Set to play against.',
  supportedDifficulties: ['intermediate'], // difficulty ignored; included for API compatibility
  move: ruleBasedMove,
}
