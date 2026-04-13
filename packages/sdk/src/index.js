// @callidity/sdk — runtime exports
// TypeScript types are defined in index.d.ts; this file provides runtime values.

/**
 * Platform default game theme tokens.
 *
 * Import this in meta.theme to explicitly declare that your game uses the platform's
 * default aesthetic. This makes the game's visual intent clear to readers and ensures
 * it continues to match the platform defaults even if they change in the future.
 *
 *   import { platformDefaultTheme } from '@callidity/sdk'
 *   export const meta = { ..., theme: platformDefaultTheme }
 *
 * Custom games can spread and override individual tokens:
 *
 *   theme: {
 *     ...platformDefaultTheme,
 *     tokens: {
 *       ...platformDefaultTheme.tokens,
 *       '--game-mark-x': '#e63946',   // red instead of blue
 *       '--game-mark-o': '#f4d03f',   // yellow instead of teal
 *     },
 *   }
 */
export const platformDefaultTheme = {
  tokens: {
    /** X player mark color — applied to the X symbol and turn/result indicators. */
    '--game-mark-x':          'var(--color-blue-600)',
    /** O player mark color — applied to the O symbol and turn/result indicators. */
    '--game-mark-o':          'var(--color-teal-600)',
    /** Background color of a winning cell. */
    '--game-cell-win-bg':     'var(--color-amber-100)',
    /** Border color of a winning cell. */
    '--game-cell-win-border': 'var(--color-amber-500)',
  },
  // No dark overrides needed: all token values reference platform CSS variables
  // (var(--color-*)) which already adapt when the .dark class is applied to <html>.
}
