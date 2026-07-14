import { describe, expect, it } from 'vitest'
import type { MemoryHubSnapshot, MemoryNote } from '@shared/memory-hub'
import { buildGraphData } from './memoryGraphData'

describe('buildGraphData', () => {
  it('keeps archived memories out of the active graph without turning them into ghosts', () => {
    const snapshot: MemoryHubSnapshot = {
      notes: [
        { name: 'active-a', title: 'Active A', updatedAt: '2026-07-14T00:00:00.000Z', linksOut: 2, backlinks: 0 },
        { name: 'active-b', title: 'Active B', updatedAt: '2026-07-14T00:00:00.000Z', linksOut: 0, backlinks: 1 },
      ],
      archived: [
        { name: 'old-history', title: 'Old History', updatedAt: '2026-07-01T00:00:00.000Z', linksOut: 0, backlinks: 1 },
      ],
      unresolved: [{ target: 'missing-note', wantedBy: ['active-a'] }],
    }
    const notes: MemoryNote[] = [
      {
        name: 'active-a',
        title: 'Active A',
        content: '[[active-b]] [[old-history]] [[missing-note]]',
        updatedAt: '2026-07-14T00:00:00.000Z',
        backlinks: [],
        outgoing: ['active-b', 'old-history'],
        unresolved: ['missing-note'],
      },
      {
        name: 'active-b',
        title: 'Active B',
        content: 'active',
        updatedAt: '2026-07-14T00:00:00.000Z',
        backlinks: ['active-a'],
        outgoing: [],
        unresolved: [],
      },
    ]

    const graph = buildGraphData(snapshot, notes)

    expect(graph.metas.map((node) => node.id).sort()).toEqual([
      'active-a',
      'active-b',
      'missing-note',
    ])
    expect(graph.edges).toEqual([
      { source: 'active-a', target: 'active-b' },
      { source: 'active-a', target: 'missing-note' },
    ])
  })
})
