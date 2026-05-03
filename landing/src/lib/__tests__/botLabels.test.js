// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect } from 'vitest'
import { disambiguateBotLabels, botLabelWithSuffix } from '../botLabels.js'

// Phase 3.8.A.3 — Mixed-list bot label disambiguation. Names are unique
// within an owner and globally for unowned built-ins, but cross-owner
// collisions ARE allowed by design — so any list that mixes owners has to
// disambiguate. The rule is: only suffix when the name actually collides in
// the visible set.

describe('disambiguateBotLabels', () => {
  it('returns plain displayName when there is no collision in the visible set', () => {
    const labels = disambiguateBotLabels([
      { id: 'b1', displayName: 'Sparky',  botOwnerId: 'u_a' },
      { id: 'b2', displayName: 'Crusher', botOwnerId: null   },
    ])
    expect(labels.get('b1')).toBe('Sparky')
    expect(labels.get('b2')).toBe('Crusher')
  })

  it('suffixes "· built-in" for unowned bots and "· @<username>" for owned bots when they collide', () => {
    const labels = disambiguateBotLabels([
      { id: 'b1', displayName: 'Rusty', botOwnerId: null   },
      { id: 'b2', displayName: 'Rusty', botOwnerId: 'u_joe',   ownerUsername: 'joe' },
      { id: 'b3', displayName: 'Rusty', botOwnerId: 'u_alice', ownerUsername: 'alice' },
    ])
    expect(labels.get('b1')).toBe('Rusty · built-in')
    expect(labels.get('b2')).toBe('Rusty · @joe')
    expect(labels.get('b3')).toBe('Rusty · @alice')
  })

  it('uses "· @you" instead of the username for the viewer\'s own bot', () => {
    const labels = disambiguateBotLabels(
      [
        { id: 'b1', displayName: 'Rusty', botOwnerId: null },
        { id: 'b2', displayName: 'Rusty', botOwnerId: 'u_joe', ownerUsername: 'joe' },
      ],
      { viewerUserId: 'u_joe' },
    )
    expect(labels.get('b2')).toBe('Rusty · @you')
  })

  it('treats name-collision case-insensitively (the DB unique index is LOWER(displayName))', () => {
    const labels = disambiguateBotLabels([
      { id: 'b1', displayName: 'rusty', botOwnerId: null },
      { id: 'b2', displayName: 'RUSTY', botOwnerId: 'u_joe', ownerUsername: 'joe' },
    ])
    expect(labels.get('b1')).toBe('rusty · built-in')
    expect(labels.get('b2')).toBe('RUSTY · @joe')
  })

  it('falls back to "@user" when an owned bot has no ownerUsername in the payload', () => {
    const labels = disambiguateBotLabels([
      { id: 'b1', displayName: 'Rusty', botOwnerId: null },
      { id: 'b2', displayName: 'Rusty', botOwnerId: 'u_x' },
    ])
    expect(labels.get('b2')).toBe('Rusty · @user')
  })

  it('returns an empty Map for missing/empty input rather than throwing', () => {
    expect(disambiguateBotLabels(null).size).toBe(0)
    expect(disambiguateBotLabels(undefined).size).toBe(0)
    expect(disambiguateBotLabels([]).size).toBe(0)
  })
})

describe('botLabelWithSuffix', () => {
  it('always renders the suffix — caller is responsible for collision detection', () => {
    expect(botLabelWithSuffix({ id: 'b1', displayName: 'Rusty', botOwnerId: null })).toBe('Rusty · built-in')
    expect(botLabelWithSuffix({ id: 'b2', displayName: 'Rusty', botOwnerId: 'u_x', ownerUsername: 'x' })).toBe('Rusty · @x')
  })
})
