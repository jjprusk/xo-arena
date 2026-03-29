/**
 * Pure-JS feedforward neural network (MLP) — no external dependencies.
 *
 * Architecture:
 *   - He initialization for hidden layer weights
 *   - Biases initialized to zero
 *   - Hidden activations: ReLU
 *   - Output activation: linear (for Q-value output)
 *
 * Supports mini-batch training via gradient accumulation.
 * Optimizer: Adam (opt-in via { useAdam: true }) or plain SGD.
 */

export class NeuralNet {
  /**
   * @param {number[]} layerSizes  e.g. [9, 64, 64, 9]
   * @param {{ useAdam?: boolean }} options
   */
  constructor(layerSizes, { useAdam = false } = {}) {
    this.layerSizes = layerSizes
    this._useAdam   = useAdam
    const L = layerSizes.length

    // weights[l] is matrix [layerSizes[l+1]][layerSizes[l]]  (row = output neuron)
    this.weights = []
    this.biases  = []
    for (let l = 0; l < L - 1; l++) {
      const fanIn  = layerSizes[l]
      const fanOut = layerSizes[l + 1]
      const w = []
      for (let j = 0; j < fanOut; j++) {
        const row = []
        for (let i = 0; i < fanIn; i++) {
          // He initialization: N(0, sqrt(2/fanIn))
          row.push(_heInit(fanIn))
        }
        w.push(row)
      }
      this.weights.push(w)
      this.biases.push(new Array(fanOut).fill(0))
    }

    this._resetGradients()
    this._batchCount = 0

    if (this._useAdam) this._initAdamState()
  }

  // ─── Forward ────────────────────────────────────────────────────────────────

  /**
   * Forward pass.
   * @param {number[]} input  flat array of length layerSizes[0]
   * @returns {{ activations: number[][], output: number[] }}
   *   activations[0] = input, activations[k] = post-activation values at layer k
   */
  forward(input) {
    const L = this.layerSizes.length
    const activations = [input.slice()]

    for (let l = 0; l < L - 1; l++) {
      const fanOut = this.layerSizes[l + 1]
      const prev   = activations[l]
      const next   = new Array(fanOut)
      const W      = this.weights[l]
      const b      = this.biases[l]
      const isLastLayer = l === L - 2

      for (let j = 0; j < fanOut; j++) {
        let z = b[j]
        const wRow = W[j]
        for (let i = 0; i < prev.length; i++) z += wRow[i] * prev[i]
        // Hidden: ReLU; output: linear
        next[j] = isLastLayer ? z : Math.max(0, z)
      }
      activations.push(next)
    }

    return { activations, output: activations[activations.length - 1] }
  }

  // ─── Backward ───────────────────────────────────────────────────────────────

  /**
   * Backward pass — accumulates gradients.
   * @param {number[]} lossGrad  dLoss/dOutput  (length = layerSizes[last])
   * @param {number[][]} activations  from forward()
   */
  backward(lossGrad, activations) {
    const L = this.layerSizes.length
    // delta[l] = dLoss/dZ for layer l (pre-activation)
    // We propagate backwards from L-1
    let delta = lossGrad.slice() // output layer is linear, so delta = lossGrad

    for (let l = L - 2; l >= 0; l--) {
      const fanOut = this.layerSizes[l + 1]
      const fanIn  = this.layerSizes[l]
      const aIn    = activations[l]   // inputs to this layer
      const aOut   = activations[l + 1] // outputs of this layer
      const W      = this.weights[l]
      const isLastLayer = l === L - 2

      // Accumulate weight and bias gradients
      for (let j = 0; j < fanOut; j++) {
        this._gradBiases[l][j] += delta[j]
        for (let i = 0; i < fanIn; i++) {
          this._gradWeights[l][j][i] += delta[j] * aIn[i]
        }
      }

      // Backprop delta to previous layer (if not input layer)
      if (l > 0) {
        const prevDelta = new Array(fanIn).fill(0)
        for (let i = 0; i < fanIn; i++) {
          let grad = 0
          for (let j = 0; j < fanOut; j++) grad += W[j][i] * delta[j]
          // ReLU derivative for hidden layers
          prevDelta[i] = grad * (aIn[i] > 0 ? 1 : 0)
        }
        delta = prevDelta
      }
    }

    this._batchCount++
  }

  // ─── Update ─────────────────────────────────────────────────────────────────

  /**
   * Apply optimizer step (Adam or SGD): update weights, reset gradients.
   * Adam: β1=0.9, β2=0.999, ε=1e-8. Bias-corrected per standard paper.
   * SGD: weight -= lr * grad / batchCount.
   * @param {number} lr  learning rate
   */
  update(lr) {
    const n = Math.max(1, this._batchCount)
    const L = this.layerSizes.length

    if (this._useAdam) {
      this._adamT++
      // Bias-correction factors (computed once per step)
      const bc1 = 1 - Math.pow(0.9,   this._adamT)
      const bc2 = 1 - Math.pow(0.999, this._adamT)
      const corrLr = lr * Math.sqrt(bc2) / bc1

      for (let l = 0; l < L - 1; l++) {
        const fanOut = this.layerSizes[l + 1]
        const fanIn  = this.layerSizes[l]
        for (let j = 0; j < fanOut; j++) {
          // Bias
          const gb = this._gradBiases[l][j] / n
          this._adamBiasM[l][j] = 0.9   * this._adamBiasM[l][j] + 0.1   * gb
          this._adamBiasV[l][j] = 0.999 * this._adamBiasV[l][j] + 0.001 * gb * gb
          this.biases[l][j] -= corrLr * this._adamBiasM[l][j] / (Math.sqrt(this._adamBiasV[l][j]) + 1e-8)
          // Weights
          for (let i = 0; i < fanIn; i++) {
            const gw = this._gradWeights[l][j][i] / n
            this._adamM[l][j][i] = 0.9   * this._adamM[l][j][i] + 0.1   * gw
            this._adamV[l][j][i] = 0.999 * this._adamV[l][j][i] + 0.001 * gw * gw
            this.weights[l][j][i] -= corrLr * this._adamM[l][j][i] / (Math.sqrt(this._adamV[l][j][i]) + 1e-8)
          }
        }
      }
    } else {
      // Plain SGD
      for (let l = 0; l < L - 1; l++) {
        const fanOut = this.layerSizes[l + 1]
        const fanIn  = this.layerSizes[l]
        for (let j = 0; j < fanOut; j++) {
          this.biases[l][j] -= lr * this._gradBiases[l][j] / n
          for (let i = 0; i < fanIn; i++) {
            this.weights[l][j][i] -= lr * this._gradWeights[l][j][i] / n
          }
        }
      }
    }

    this._resetGradients()
  }

  // ─── Serialization ──────────────────────────────────────────────────────────

  /**
   * Returns a plain object suitable for DB storage.
   * weights and biases are flattened to 1-D arrays for compactness.
   */
  serialize() {
    return {
      layerSizes: this.layerSizes.slice(),
      weights: this.weights.map(W => W.flat()),
      biases:  this.biases.map(b => b.slice()),
    }
  }

  /**
   * Restore a NeuralNet from a serialized object produced by serialize().
   * Adam moment state is NOT serialized — it resets on load (weights/biases are authoritative).
   * @param {{ layerSizes: number[], weights: number[][], biases: number[][] }} data
   * @param {{ useAdam?: boolean }} options  passed through to constructor
   * @returns {NeuralNet}
   */
  static fromJSON(data, options = {}) {
    const net = new NeuralNet(data.layerSizes, options)
    const L   = data.layerSizes.length
    for (let l = 0; l < L - 1; l++) {
      const fanIn  = data.layerSizes[l]
      const fanOut = data.layerSizes[l + 1]
      const flat   = data.weights[l]
      const W      = []
      for (let j = 0; j < fanOut; j++) {
        W.push(flat.slice(j * fanIn, (j + 1) * fanIn))
      }
      net.weights[l] = W
      net.biases[l]  = data.biases[l].slice()
    }
    return net
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  _resetGradients() {
    // Zero in-place on first use; allocate once and reuse to avoid GC churn
    if (!this._gradWeights) {
      this._gradWeights = this.weights.map(W => W.map(row => new Float64Array(row.length)))
      this._gradBiases  = this.biases.map(b => new Float64Array(b.length))
    } else {
      for (const layer of this._gradWeights) for (const row of layer) row.fill(0)
      for (const layer of this._gradBiases) layer.fill(0)
    }
    this._batchCount = 0
  }

  /** Allocate Adam first/second moment accumulators (zeroed). */
  _initAdamState() {
    this._adamT     = 0
    this._adamM     = this.weights.map(W => W.map(row => new Float64Array(row.length)))
    this._adamV     = this.weights.map(W => W.map(row => new Float64Array(row.length)))
    this._adamBiasM = this.biases.map(b => new Float64Array(b.length))
    this._adamBiasV = this.biases.map(b => new Float64Array(b.length))
  }
}

/** He initialization: value in [-sqrt(1/fanIn), sqrt(1/fanIn)] scaled by sqrt(2/fanIn). */
function _heInit(fanIn) {
  return (Math.random() * 2 - 1) * Math.sqrt(2 / fanIn)
}
