// Copyright © 2026 Joe Pruskowski. All rights reserved.

/** @type {import('@callidity/sdk').GameMeta} */
export const meta = {
  id:               'xo',
  title:            'Tic-Tac-Toe',
  description:      'Classic 3×3 strategy game. First to get three in a row wins.',
  minPlayers:       2,
  maxPlayers:       2,
  supportsBots:     true,
  supportsTraining: true,
  supportsPuzzles:  true,
  builtInBots: [
    {
      id:         'minimax-novice',
      name:       'Rusty',
      description:'Makes mistakes on purpose. Great for beginners.',
      difficulty: 'easy',
      algorithm:  'minimax',
    },
    {
      id:         'minimax-intermediate',
      name:       'Copper',
      description:'A decent challenge. Will punish obvious mistakes.',
      difficulty: 'medium',
      algorithm:  'minimax',
    },
    {
      id:         'minimax-advanced',
      name:       'Sterling',
      description:'Plays well. Difficult to beat without a solid strategy.',
      difficulty: 'hard',
      algorithm:  'minimax',
    },
    {
      id:         'minimax-master',
      name:       'Magnus',
      description:'Perfect play. Never loses.',
      difficulty: 'expert',
      algorithm:  'minimax',
    },
    {
      id:         'rule-novice',
      name:       'Rookie',
      description:'Rule-based with beginner-level heuristics.',
      difficulty: 'beginner',
      algorithm:  'rule_based',
    },
    {
      id:         'ql-trained',
      name:       'Trained AI',
      description:'Learns from experience. Strength depends on training.',
      difficulty: 'medium',
      algorithm:  'qlearning',
    },
  ],
}
