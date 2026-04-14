/** @type {GameMeta} */
export const meta = {
  id:               'pong',
  title:            'Pong',
  description:      'Classic real-time paddle game. First to 7 wins.',
  minPlayers:       2,
  maxPlayers:       2,
  layout: {
    preferredWidth: 'wide',
    aspectRatio:    '4/3',
  },
  supportsBots:     false,
  supportsTraining: false,
  supportsPuzzles:  false,
  builtInBots:      [],
  // Spike flag — remove with the package when the spike is torn down
  isSpike:          true,
}
