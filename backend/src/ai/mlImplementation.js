/**
 * ML implementation for the AI registry.
 *
 * When the frontend selects implementation='ml', the move endpoint
 * passes modelId to this implementation, which loads (or cache-hits)
 * the Q-table and returns the best move via pure exploitation.
 */

import { getMoveForModel } from '../services/mlService.js'
import { getEmptyCells } from './gameLogic.js'

export const mlImplementation = {
  id: 'ml',
  name: 'ML Agent',
  description: 'Reinforcement-learning agent. Select a trained model via modelId.',
  supportedDifficulties: ['novice', 'intermediate', 'master'], // ignored — difficulty is meaningless for ML
  async move(board, _difficulty, _player, modelId) {
    if (!modelId) {
      // Fallback: random move if no model specified
      const empty = getEmptyCells(board)
      return empty[Math.floor(Math.random() * empty.length)]
    }
    return getMoveForModel(modelId, board)
  },
}
