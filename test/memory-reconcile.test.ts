import { describe, expect, it } from 'vitest'
import { reconcile, textSimilarity } from '@shared/memory-reconcile'
import type { MemoryDoc } from '@shared/memory-hub'
import type { Observation } from '@shared/memory-observation'

const obs = (over: Partial<Observation> = {}): Observation => ({
  scope: 'project',
  class: 'decision',
  targetSlug: 'router-placement',
  isNew: true,
  title: 'Router in shared',
  body: 'The router lives in shared so both bridges classify identically.',
  links: [],
  decision: 'save',
  reason: 'clear',
  ...over,
})

const doc = (name: string, content: string): MemoryDoc => ({
  name,
  content,
  updatedAt: '2026-07-04T10:00:00Z',
})

describe('textSimilarity', () => {
  it('is 1 for identical text and 0 for disjoint', () => {
    expect(textSimilarity('alpha beta gamma', 'alpha beta gamma')).toBe(1)
    expect(textSimilarity('alpha beta', 'delta epsilon')).toBe(0)
  })
})

describe('reconcile', () => {
  it('returns NEW when the slug is free and nothing is similar', () => {
    const r = reconcile(obs(), [doc('unrelated', 'completely different subject matter here')])
    expect(r.decision).toBe('new')
    expect(r.targetSlug).toBe('router-placement')
  })

  it('returns DUPLICATE when an existing note already says the same thing', () => {
    const existing = doc('router-placement', 'The router lives in shared so both bridges classify identically.')
    const r = reconcile(obs(), [existing])
    expect(r.decision).toBe('duplicate')
    expect(r.similarity).toBeGreaterThan(0.8)
  })

  it('returns CONFLICT when the slug is taken but content differs and model said new', () => {
    const existing = doc('router-placement', 'This note is about something entirely unrelated to routing at all.')
    const r = reconcile(obs({ isNew: true }), [existing])
    expect(r.decision).toBe('conflict')
    expect(r.existingContent).toBeTruthy()
  })

  it('returns MERGE when the slug matches, content differs, and model did not claim new', () => {
    const existing = doc('router-placement', 'Older partial note about the routing subsystem and its shape.')
    const r = reconcile(obs({ isNew: false }), [existing])
    expect(r.decision).toBe('merge')
  })

  it('detects a duplicate filed under a different slug', () => {
    const existing = doc('routing-notes', 'The router lives in shared so both bridges classify identically.')
    const r = reconcile(obs({ targetSlug: 'brand-new-slug' }), [existing])
    expect(r.decision).toBe('duplicate')
    expect(r.targetSlug).toBe('routing-notes')
  })

  it('ignores frontmatter when measuring similarity', () => {
    const existing = doc(
      'router-placement',
      '---\nschema: 1\nname: router-placement\ntitle: X\nclass: decision\ngate: save\nupdatedAt: 2026-07-04T10:00:00.000Z\n---\nThe router lives in shared so both bridges classify identically.',
    )
    const r = reconcile(obs(), [existing])
    expect(r.decision).toBe('duplicate')
  })
})
