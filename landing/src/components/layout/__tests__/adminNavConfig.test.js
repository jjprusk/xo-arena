// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect } from 'vitest'
import { filterNavForRoles, ADMIN_NAV_SECTIONS } from '../adminNavConfig.js'

function linksOf(sections) {
  return sections.flatMap(s => s.links.map(l => l.to))
}

describe('filterNavForRoles', () => {
  it('BA admin (legacy role === "admin") sees every section + every link', () => {
    const sections = filterNavForRoles({ isBaAdmin: true, domainRoles: [] })
    expect(sections.map(s => s.id)).toEqual(['platform', 'operations', 'content'])
    // Round-trip: every link in the source config should be visible.
    const allLinks = ADMIN_NAV_SECTIONS.flatMap(s => s.links.map(l => l.to))
    expect(linksOf(sections)).toEqual(allLinks)
  })

  it('domain ADMIN role sees every section + every link (parity with BA admin)', () => {
    const sections = filterNavForRoles({ isBaAdmin: false, domainRoles: ['ADMIN'] })
    expect(sections.map(s => s.id)).toEqual(['platform', 'operations', 'content'])
    const allLinks = ADMIN_NAV_SECTIONS.flatMap(s => s.links.map(l => l.to))
    expect(linksOf(sections)).toEqual(allLinks)
  })

  it('HELP_ADMIN-only sees just the Content section (Help + Queue + Metrics)', () => {
    const sections = filterNavForRoles({ isBaAdmin: false, domainRoles: ['HELP_ADMIN'] })
    expect(sections.map(s => s.id)).toEqual(['content'])
    expect(linksOf(sections)).toEqual(['/admin/help', '/admin/help/queries', '/admin/help/metrics'])
  })

  it('TOURNAMENT_ADMIN-only sees just Operations → Tournaments', () => {
    const sections = filterNavForRoles({ isBaAdmin: false, domainRoles: ['TOURNAMENT_ADMIN'] })
    expect(sections.map(s => s.id)).toEqual(['operations'])
    expect(linksOf(sections)).toEqual(['/admin/tournaments'])
  })

  it('BOT_ADMIN-only sees Operations → ML Models + Bots', () => {
    const sections = filterNavForRoles({ isBaAdmin: false, domainRoles: ['BOT_ADMIN'] })
    expect(sections.map(s => s.id)).toEqual(['operations'])
    expect(linksOf(sections)).toEqual(['/admin/ml-models', '/admin/bots'])
  })

  it('SUPPORT-only sees Operations → Feedback', () => {
    const sections = filterNavForRoles({ isBaAdmin: false, domainRoles: ['SUPPORT'] })
    expect(sections.map(s => s.id)).toEqual(['operations'])
    expect(linksOf(sections)).toEqual(['/admin/feedback'])
  })

  it('combines multiple non-ADMIN roles additively', () => {
    const sections = filterNavForRoles({
      isBaAdmin:   false,
      domainRoles: ['HELP_ADMIN', 'TOURNAMENT_ADMIN'],
    })
    expect(sections.map(s => s.id)).toEqual(['operations', 'content'])
    expect(linksOf(sections)).toEqual([
      '/admin/tournaments',
      '/admin/help', '/admin/help/queries', '/admin/help/metrics',
    ])
  })

  it('user with no relevant roles sees no sections', () => {
    const sections = filterNavForRoles({ isBaAdmin: false, domainRoles: [] })
    expect(sections).toEqual([])
  })

  it('tolerates non-array domainRoles input', () => {
    const sections = filterNavForRoles({ isBaAdmin: true, domainRoles: null })
    // BA admin should still see everything even with null roles.
    expect(sections).toHaveLength(3)
  })

  it('strips out empty sections (no labels orphaned)', () => {
    // SUPPORT only gates Feedback, which lives in Operations — Platform
    // and Content should be entirely absent, not rendered as empty
    // labels.
    const sections = filterNavForRoles({ isBaAdmin: false, domainRoles: ['SUPPORT'] })
    expect(sections.find(s => s.id === 'platform')).toBeUndefined()
    expect(sections.find(s => s.id === 'content')).toBeUndefined()
  })
})
