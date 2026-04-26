// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect } from 'vitest'
import { pickCoachingCard, COACHING_CARDS } from '../coachingCardRules.js'

describe('pickCoachingCard — branch coverage', () => {
  it('finalPosition=1 → CHAMPION', () => {
    expect(pickCoachingCard({ finalPosition: 1 })).toBe(COACHING_CARDS.CHAMPION)
  })

  it('finalPosition=2 → RUNNER_UP', () => {
    expect(pickCoachingCard({ finalPosition: 2 })).toBe(COACHING_CARDS.RUNNER_UP)
  })

  it('lost in semis with didTrainImprove → ONE_TRAIN_LOSS', () => {
    const card = pickCoachingCard({ finalPosition: 3, lostInSemis: true, didTrainImprove: true })
    expect(card).toBe(COACHING_CARDS.ONE_TRAIN_LOSS)
  })

  it('lost in semis without train improvement → HEAVY_LOSS', () => {
    const card = pickCoachingCard({ finalPosition: 3, lostInSemis: true, didTrainImprove: false })
    expect(card).toBe(COACHING_CARDS.HEAVY_LOSS)
  })

  it('finalPosition >= 3 with lostInSemis omitted defaults to HEAVY_LOSS', () => {
    expect(pickCoachingCard({ finalPosition: 4 })).toBe(COACHING_CARDS.HEAVY_LOSS)
  })

  it('finalPosition=4 with didTrainImprove but lostInSemis=false → HEAVY_LOSS (defensive)', () => {
    // Defensive: in the cup the only finishing positions are 1-4 and >2 implies
    // semi-loss. But the rule shouldn't trip the train-improve branch unless
    // the caller explicitly passes lostInSemis=true.
    const card = pickCoachingCard({ finalPosition: 4, lostInSemis: false, didTrainImprove: true })
    expect(card).toBe(COACHING_CARDS.HEAVY_LOSS)
  })

  it('returns null when finalPosition is missing', () => {
    expect(pickCoachingCard({})).toBeNull()
    expect(pickCoachingCard({ finalPosition: null })).toBeNull()
    expect(pickCoachingCard()).toBeNull()
  })
})

describe('COACHING_CARDS — every branch has a complete card', () => {
  for (const [key, card] of Object.entries(COACHING_CARDS)) {
    it(`${key} has id, title, body, ctaLabel, ctaHref`, () => {
      expect(card.id).toBeTruthy()
      expect(card.title).toBeTruthy()
      expect(card.body).toBeTruthy()
      expect(card.ctaLabel).toBeTruthy()
      expect(card.ctaHref).toMatch(/^\//)
    })
  }
})
