import { describe, expect, it } from 'vitest'
import { assembleHubSnapshot, type MemoryDoc } from '@shared/memory-hub'
import { serializeNote, type NoteFrontmatter } from '@shared/memory-note-schema'
import {
  MEMORY_RECENT_LIMIT,
  notesForLibrary,
  shownLibraryNotes,
} from './memoryLibraryModel'

function note(index: number, status: NoteFrontmatter['status']): MemoryDoc {
  const name = `memory-${String(index).padStart(3, '0')}`
  return {
    name,
    updatedAt: new Date(Date.UTC(2026, 6, 14, 0, index)).toISOString(),
    content: serializeNote({
      schema: 2,
      name,
      title: `Memory ${String(index).padStart(3, '0')}`,
      class: 'reference',
      gate: 'save',
      updatedAt: '2026-07-14T00:00:00.000Z',
      tags: [],
      status,
      authority: 'observed',
      scope: 'project',
      confidence: 'high',
      firstSeenAt: '2026-07-14T00:00:00.000Z',
      reviewAfter: '2027-01-14T00:00:00.000Z',
      supersedes: [],
    }, `Durable fact ${index}`),
  }
}

describe('memory library model at real-project scale', () => {
  const snapshot = assembleHubSnapshot([
    ...Array.from({ length: 99 }, (_, index) => note(index, 'active')),
    ...Array.from({ length: 31 }, (_, index) => note(index + 99, 'archived')),
  ])

  it('defaults to active memories and keeps archive separate', () => {
    expect(notesForLibrary(snapshot, 'active')).toHaveLength(99)
    expect(notesForLibrary(snapshot, 'archive')).toHaveLength(31)
  })

  it('bounds the default DOM while search and Browse all still reach every active memory', () => {
    const active = notesForLibrary(snapshot, 'active')
    expect(shownLibraryNotes(active, '', false)).toHaveLength(MEMORY_RECENT_LIMIT)
    expect(shownLibraryNotes(active, 'memory-000', false).map((entry) => entry.name)).toEqual([
      'memory-000',
    ])
    expect(shownLibraryNotes(active, '', true)).toHaveLength(99)
  })
})
