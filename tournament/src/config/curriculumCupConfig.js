// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Curriculum Cup shape (Intelligent Guide §5.4).
 *
 * Kept as constants in code rather than a TournamentTemplate row because
 *   1. The Cup is spawned-on-demand, not recurring (TournamentTemplate's
 *      raison d'être is `recurrenceInterval`/`recurrenceStart`).
 *   2. The slot mix is part of the Curriculum design — changing it is a
 *      product call, not an admin tuning knob.
 *   3. Avoids a migration that would seed a bare TournamentTemplate row
 *      whose `recurrenceInterval` would be a meaningless required field.
 *
 * The `clone` endpoint (POST /api/tournaments/curriculum-cup/clone) reads
 * this config to size the bracket and pick opponent tiers.
 */

export const CURRICULUM_CUP_CONFIG = Object.freeze({
  name:            'Curriculum Cup',
  game:            'xo',
  mode:            'BOT_VS_BOT',           // bots play, human spectates
  format:          'FLASH',                // spawned-on-demand, no registration window
  bracketType:     'SINGLE_ELIM',
  bestOfN:         1,
  minParticipants: 4,
  maxParticipants: 4,
  paceMs:          1000,                   // brisk so the cup wraps in ~2 min
  // Opponent slots — 3 system bots draw from these tiers/pools.
  opponentSlots: Object.freeze([
    { tier: 'rusty',  builtinUsername: 'bot-rusty'  },
    { tier: 'rusty',  builtinUsername: 'bot-rusty'  },
    { tier: 'copper', builtinUsername: 'bot-copper' },
  ]),
})
