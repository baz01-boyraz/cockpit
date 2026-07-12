import { describe, expect, it } from 'vitest'
import type { ReviewItem } from '../shared/memory-review'
import {
  isBatchCleanup,
  presentMemoryReview,
  summarizeMemoryReviews,
} from '../shared/memory-review-presentation'

const item = (over: Partial<ReviewItem> = {}): ReviewItem => ({
  id: 'review-1',
  brain: 'project:p1',
  kind: 'new',
  slug: 'release-process',
  title: 'Release process',
  proposedContent: '# Release process\n\nUse the signed release workflow.',
  reason: 'A durable project decision was found in the latest session.',
  existingContent: null,
  sourceId: null,
  alsoTrash: null,
  status: 'pending',
  createdAt: '2026-07-11T00:00:00.000Z',
  resolvedAt: null,
  ...over,
})

describe('presentMemoryReview', () => {
  it('turns a legacy archive proposal into one plain-language cleanup decision', () => {
    const review = item({
      kind: 'maintenance',
      slug: 'stale-fact',
      title: 'Archive stale note: stale-fact',
      reason: 'Curation — archive: no longer true',
      proposedContent: '# Stale fact\n\nSomething that used to be true.',
      existingContent: '# Stale fact\n\nSomething that used to be true.',
    })

    const view = presentMemoryReview(review)

    expect(view.category).toBe('cleanup')
    expect(view.title).toBe('Archive “Stale fact”?')
    expect(view.summary).toMatch(/recoverable/i)
    expect(view.acceptLabel).toBe('Archive note')
    expect(view.discardLabel).toBe('Keep it active')
    expect(view.canEdit).toBe(false)
    expect(isBatchCleanup(review)).toBe(true)
  })

  it('describes duplicate cleanup without exposing slugs or pipeline jargon', () => {
    const review = item({
      kind: 'maintenance',
      slug: 'canonical-note',
      title: 'Merge duplicate: duplicate-note → canonical-note',
      reason: 'Curation — merge: both notes capture the same decision',
      proposedContent: '# Canonical note\n\nCombined detail.',
      existingContent: '# Canonical note\n\nOriginal detail.',
      alsoTrash: 'duplicate-note',
    })

    const view = presentMemoryReview(review)

    expect(view.title).toBe('Combine “Duplicate note” with “Canonical note”?')
    expect(view.summary).toMatch(/one cleaner memory/i)
    expect(view.acceptLabel).toBe('Combine notes')
    expect(view.canEdit).toBe(false)
    expect(isBatchCleanup(review)).toBe(true)
  })

  it('makes a conflict explicit and never marks it safe for a batch action', () => {
    const review = item({
      kind: 'conflict',
      slug: 'release-process',
      title: 'Release process changed',
      existingContent: '# Release process\n\nUse the old workflow.',
    })

    const view = presentMemoryReview(review)

    expect(view.category).toBe('attention')
    expect(view.title).toBe('Choose which version to remember')
    expect(view.acceptLabel).toBe('Use new version')
    expect(view.discardLabel).toBe('Keep current version')
    expect(view.canEdit).toBe(true)
    expect(isBatchCleanup(review)).toBe(false)
  })

  it('explains an ordinary memory update without model or pipeline language', () => {
    const review = item({
      kind: 'merge',
      title: 'Router placement update',
      reason: 'model confidence 0.71; reconcile=merge',
      existingContent: '# Router placement\n\nThe router was renderer-only.',
      proposedContent: '# Router placement\n\nThe router is shared by both processes.',
    })

    const view = presentMemoryReview(review)

    expect(view.title).toBe('Update “Router placement”?')
    expect(view.rationale).toBe('A recent session found a detail that belongs with this memory.')
    expect(view.rationale).not.toMatch(/model|reconcile/i)
    expect(view.acceptLabel).toBe('Add detail')
  })

  it('recognizes an older archive row from its curation reason alone', () => {
    const review = item({
      kind: 'maintenance',
      title: 'Old cleanup suggestion',
      reason: 'Curation — archive: no longer active',
      existingContent: '# Old note\n\nA retired implementation detail.',
    })

    expect(presentMemoryReview(review).acceptLabel).toBe('Archive note')
    expect(isBatchCleanup(review)).toBe(true)
  })

  it('summarizes a mixed inbox into human-sized groups', () => {
    const reviews = [
      item({ id: 'a', kind: 'maintenance', title: 'Archive stale note: old', slug: 'old' }),
      item({ id: 'b', kind: 'maintenance', title: 'Merge duplicate: b → a', alsoTrash: 'b' }),
      item({ id: 'c', kind: 'conflict' }),
      item({ id: 'd', kind: 'new' }),
    ]

    expect(summarizeMemoryReviews(reviews)).toEqual({
      cleanup: 2,
      attention: 1,
      suggestions: 1,
    })
  })
})
