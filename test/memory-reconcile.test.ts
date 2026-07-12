import { describe, expect, it } from 'vitest'
import {
  DUPLICATE_SIMILARITY,
  reconcile,
  textSimilarity,
} from '@shared/memory-reconcile'
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

const longNoteWithFact = (fact: string): string =>
  [
    'A long-lived architecture note with independent historical facts.',
    ...Array.from(
      { length: 12 },
      (_, index) =>
        `- (2026-06-01) unrelatedtopic${index} component${index} behavior${index} remains documented separately`,
    ),
    'Related: [[ipc-contract]]',
    `- (2026-07-01) ${fact}`,
  ].join('\n')

describe('textSimilarity', () => {
  it('is 1 for identical text and 0 for disjoint', () => {
    expect(textSimilarity('alpha beta gamma', 'alpha beta gamma')).toBe(1)
    expect(textSimilarity('alpha beta', 'delta epsilon')).toBe(0)
  })

  it('keeps Turkish words intact instead of tokenizing an exact fact to empty', () => {
    expect(textSimilarity('Çağrı ölçümü', 'Çağrı ölçümü')).toBe(1)
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

  it('finds a duplicate atomic bullet inside a long accumulated note', () => {
    const existing = doc('router-placement', longNoteWithFact(obs().body))

    const r = reconcile(obs({ isNew: false }), [existing])

    expect(r.decision).toBe('duplicate')
    expect(r.similarity).toBe(1)
  })

  it('keeps the duplicate threshold inclusive without swallowing the just-below case', () => {
    const sharedAtThreshold = Array.from({ length: 41 }, (_, index) => `common${index}`).join(' ')
    const atThresholdBody = `${sharedAtThreshold} left0 left1 left2 left3`
    const atThresholdExisting = `${sharedAtThreshold} right0 right1 right2 right3 right4`
    expect(textSimilarity(atThresholdBody, atThresholdExisting)).toBe(DUPLICATE_SIMILARITY)
    expect(
      reconcile(obs({ isNew: false, body: atThresholdBody }), [
        doc('router-placement', atThresholdExisting),
      ]).decision,
    ).toBe('duplicate')

    const sharedBelow = Array.from({ length: 40 }, (_, index) => `common${index}`).join(' ')
    const belowBody = `${sharedBelow} left0 left1 left2 left3`
    const belowExisting = `${sharedBelow} right0 right1 right2 right3 right4`
    expect(textSimilarity(belowBody, belowExisting)).toBeLessThan(DUPLICATE_SIMILARITY)
    expect(
      reconcile(obs({ isNew: false, body: belowBody }), [
        doc('router-placement', belowExisting),
      ]).decision,
    ).toBe('merge')
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
