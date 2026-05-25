// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { platformDefaultTheme } from '@callidity/sdk'

/**
 * Connect Four GameMeta. Strict SDK conformance per
 * `packages/sdk/src/index.d.ts → GameMeta`.
 *
 * Notes specific to this game:
 *
 * - `inputMode: 'column'` — players choose a column; gravity drops the
 *   piece. The platform uses this to render appropriate a11y labels and
 *   mobile gesture hints. The game component (B2) still implements its
 *   own input.
 * - `layout.preferredWidth: 'wide'` — the 6×7 board is the canonical
 *   case for `wide` per the SDK layout table.
 * - `tournamentMovesElo: true` — Connect Four is not solved at the level
 *   of "first move always wins under tournament time controls", so the
 *   bracket carries real skill signal and should move ELO. (TTT, by
 *   contrast, leaves this off because its tournaments degrade into
 *   coinflip tiebreakers.)
 * - `matchFormat.master: 'bo2'` — the Master Challenge format. Paired
 *   with the master `BotPersona` below which sets `offLadder: true`, so
 *   losses to the solver do not move ELO.
 * - `masterStrategy: 'solver'` — the Master tier plays via the perfect-
 *   play solver in `master.js` (B1.6), not via depth-limited minimax.
 */

/** @type {import('@callidity/sdk').GameMeta} */
export const meta = {
  id:               'connect-four',
  title:            'Connect Four',
  description:      'Drop pieces into a 6×7 grid. First to line up four in any direction wins.',
  minPlayers:       2,
  maxPlayers:       2,
  tableArchetype:   'sit-down',
  layout: {
    preferredWidth: 'wide',
    aspectRatio:    '7/6',
  },
  inputMode:        'column',
  theme:            platformDefaultTheme,
  supportsBots:     true,
  supportsTraining: true,
  supportsPuzzles:  false, // Puzzles can land in a later sprint.
  tournamentMovesElo: true,
  matchFormat: {
    ranked:     'bo2',
    tournament: 'bo3',
    master:     'bo2',
  },
  masterStrategy: 'solver',
  builtInBots: [
    {
      id:          'minimax-easy',
      name:        'Pebble',
      description: 'Shallow search. Makes obvious tactical mistakes.',
      difficulty:  'easy',
      algorithm:   'minimax',
    },
    {
      id:          'minimax-medium',
      name:        'Granite',
      description: 'Looks four moves ahead. Will punish hanging threats.',
      difficulty:  'medium',
      algorithm:   'minimax',
    },
    {
      id:          'minimax-hard',
      name:        'Basalt',
      description: 'Six-ply search. A real challenge for casual players.',
      difficulty:  'hard',
      algorithm:   'minimax',
    },
    {
      id:          'minimax-master',
      name:        'Obsidian',
      description: 'Perfect play. First-player wins — pick your color carefully.',
      difficulty:  'master',
      algorithm:   'minimax',
      offLadder:   true,
    },
  ],
}
