import { describe, expect, it } from 'vitest'
import { assembleHealth } from '@shared/memory-health'
import type { MemoryDoc } from '@shared/memory-hub'

const doc = (name: string, content: string): MemoryDoc => ({
  name,
  content,
  updatedAt: '2026-07-04T10:00:00.000Z',
})

describe('assembleHealth', () => {
  it('counts notes, ignoring foreign filenames', () => {
    const h = assembleHealth([doc('a', 'x'), doc('b', 'y')])
    expect(h.noteCount).toBe(2)
  })

  it('flags orphans (no links in or out)', () => {
    // a <-> b linked; c is an island
    const docs = [
      doc('a', 'see [[b]]'),
      doc('b', 'see [[a]]'),
      doc('c', 'alone'),
    ]
    const h = assembleHealth(docs)
    expect(h.orphanCount).toBe(1)
  })

  it('counts distinct unresolved link targets', () => {
    const docs = [doc('a', 'links [[ghost]] and [[phantom]] and [[ghost]] again')]
    const h = assembleHealth(docs)
    expect(h.unresolvedCount).toBe(2)
  })

  it('flags oversized notes against a threshold', () => {
    const docs = [doc('big', 'x'.repeat(200)), doc('small', 'x')]
    const h = assembleHealth(docs, { oversizeBytes: 100 })
    expect(h.oversizedCount).toBe(1)
    expect(h.totalBytes).toBe(201)
  })

  it('is empty-safe', () => {
    expect(assembleHealth([])).toEqual({
      noteCount: 0,
      orphanCount: 0,
      unresolvedCount: 0,
      oversizedCount: 0,
      totalBytes: 0,
    })
  })
})
