import { describe, it, expect } from 'vitest'
import { NeuralNet } from '@xo-arena/ai'

describe('NeuralNet', () => {
  it('forward pass produces correct output shape', () => {
    const net = new NeuralNet([9, 16, 9])
    const input = Array(9).fill(0)
    const { activations, output } = net.forward(input)
    expect(output).toHaveLength(9)
    expect(activations).toHaveLength(3)   // input + 2 layers
    expect(activations[0]).toHaveLength(9)
    expect(activations[1]).toHaveLength(16)
    expect(activations[2]).toHaveLength(9)
  })

  it('forward pass with non-zero input produces non-trivial output', () => {
    const net = new NeuralNet([4, 8, 4])
    const input = [1, -1, 0.5, -0.5]
    const { output } = net.forward(input)
    expect(output).toHaveLength(4)
    // Output should not all be zero (extremely unlikely with He init)
    expect(output.some(v => v !== 0)).toBe(true)
  })

  it('backward + update reduces loss on a simple linear target', () => {
    // Train a tiny net to output [1, 0] for input [1, 0]
    const net = new NeuralNet([2, 4, 2])
    const input  = [1, 0]
    const target = [1, 0]
    const lr     = 0.05

    let initialLoss = null
    for (let i = 0; i < 200; i++) {
      const { output, activations } = net.forward(input)
      const lossGrad = output.map((v, j) => 2 * (v - target[j]))
      const loss = output.reduce((s, v, j) => s + (v - target[j]) ** 2, 0)
      if (initialLoss === null) initialLoss = loss
      net.backward(lossGrad, activations)
      net.update(lr)
    }

    const { output: finalOutput } = net.forward(input)
    const finalLoss = finalOutput.reduce((s, v, j) => s + (v - target[j]) ** 2, 0)
    expect(finalLoss).toBeLessThan(initialLoss)
  })

  it('serialize/fromJSON roundtrip preserves weights', () => {
    const net = new NeuralNet([4, 8, 4])
    // Run a forward to ensure weights are initialized
    net.forward([1, 2, 3, 4])

    const data     = net.serialize()
    const restored = NeuralNet.fromJSON(data)

    // Check same layer sizes
    expect(restored.layerSizes).toEqual(net.layerSizes)

    // Check weights match
    for (let l = 0; l < net.weights.length; l++) {
      for (let j = 0; j < net.weights[l].length; j++) {
        for (let i = 0; i < net.weights[l][j].length; i++) {
          expect(restored.weights[l][j][i]).toBeCloseTo(net.weights[l][j][i], 10)
        }
      }
    }
  })

  it('serialize/fromJSON roundtrip produces identical output', () => {
    const net   = new NeuralNet([9, 32, 9])
    const input = [1, -1, 0, 1, -1, 0, 0, 0, 0]
    const { output: orig } = net.forward(input)

    const restored          = NeuralNet.fromJSON(net.serialize())
    const { output: rest }  = restored.forward(input)

    for (let i = 0; i < orig.length; i++) {
      expect(rest[i]).toBeCloseTo(orig[i], 8)
    }
  })

  it('He initialization: mean of first hidden layer weights ≈ 0', () => {
    // Use a large net to get a stable mean estimate
    const net    = new NeuralNet([64, 256, 9])
    const flat   = net.weights[0].flat()
    const mean   = flat.reduce((s, v) => s + v, 0) / flat.length
    // Mean of He-init weights should be close to 0 (symmetric distribution)
    expect(Math.abs(mean)).toBeLessThan(0.15)
  })

  it('biases are initialized to zero', () => {
    const net = new NeuralNet([9, 32, 9])
    for (const bias of net.biases) {
      expect(bias.every(b => b === 0)).toBe(true)
    }
  })

  it('update resets gradient accumulation', () => {
    const net = new NeuralNet([4, 8, 4])
    const { output, activations } = net.forward([1, 2, 3, 4])
    const grad = output.map(v => v * 2)
    net.backward(grad, activations)
    expect(net._batchCount).toBe(1)
    net.update(0.01)
    expect(net._batchCount).toBe(0)
  })
})
