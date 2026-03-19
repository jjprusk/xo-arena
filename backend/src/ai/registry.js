/**
 * AI implementation registry.
 *
 * To add a new AI: import it here and call registry.register(implementation).
 * The implementation must export an object with:
 *   { id, name, description, supportedDifficulties, move(board, difficulty, player) => index }
 */

import { minimaxImplementation } from './minimax.js'
import { mlImplementation } from './mlImplementation.js'

class AIRegistry {
  constructor() {
    /** @type {Map<string, object>} */
    this._implementations = new Map()
  }

  register(impl) {
    if (!impl.id || !impl.name || !impl.move) {
      throw new Error(`Invalid AI implementation: missing required fields`)
    }
    this._implementations.set(impl.id, impl)
  }

  get(id) {
    return this._implementations.get(id) || null
  }

  list() {
    return [...this._implementations.values()].map(({ id, name, description, supportedDifficulties }) => ({
      id,
      name,
      description,
      supportedDifficulties,
    }))
  }

  has(id) {
    return this._implementations.has(id)
  }

  validIds() {
    return [...this._implementations.keys()]
  }
}

const registry = new AIRegistry()

// Register built-in implementations
registry.register(minimaxImplementation)
registry.register(mlImplementation)

export default registry
