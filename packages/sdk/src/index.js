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
 * Token naming is game-agnostic: `--game-mark-1` is the first-mover / first
 * player mark color, `--game-mark-2` is the second. Map them to whatever your
 * game calls its sides (X/O, Red/Yellow, Black/White, etc.) inside your game
 * component.
 *
 * Custom games can spread and override individual tokens:
 *
 *   theme: {
 *     ...platformDefaultTheme,
 *     tokens: {
 *       ...platformDefaultTheme.tokens,
 *       '--game-mark-1': '#e63946',   // red for first player
 *       '--game-mark-2': '#f4d03f',   // yellow for second player
 *     },
 *   }
 */
export const platformDefaultTheme = {
  tokens: {
    /** First player mark color (X in TTT, Red in Connect Four, etc.). */
    '--game-mark-1':          'var(--color-blue-600)',
    /** Second player mark color (O in TTT, Yellow in Connect Four, etc.). */
    '--game-mark-2':          'var(--color-teal-600)',
    /** Background color of a winning cell. */
    '--game-cell-win-bg':     'var(--color-amber-100)',
    /** Border color of a winning cell. */
    '--game-cell-win-border': 'var(--color-amber-500)',
  },
  // No dark overrides needed: all token values reference platform CSS variables
  // (var(--color-*)) which already adapt when the .dark class is applied to <html>.
}
