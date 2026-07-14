import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from '@shared/memory-ledger'
import {
  memorySourceForEntry,
  memorySourceFromId,
  summarizeMemoryProvenance,
} from './memoryProvenance'

function entry(
  id: string,
  action: LedgerEntry['action'],
  sourceId: string | null,
  createdAt: string,
  gate: LedgerEntry['gate'] = 'save',
): LedgerEntry {
  return {
    id,
    brain: 'project:project-1',
    noteSlug: 'memory-source',
    action,
    gate,
    sourceId,
    hashBefore: null,
    hashAfter: 'a'.repeat(64),
    createdAt,
  }
}

describe('memory provenance', () => {
  it('recognizes provider-qualified Claude and Codex session ids', () => {
    expect(memorySourceFromId('claude:session-a')).toMatchObject({
      kind: 'claude',
      label: 'Claude',
      sessionId: 'session-a',
    })
    expect(memorySourceFromId('codex:session-b')).toMatchObject({
      kind: 'codex',
      label: 'Codex',
      sessionId: 'session-b',
    })
  })

  it('does not invent a provider for legacy, manual, or Cockpit changes', () => {
    expect(memorySourceFromId('legacy-session')).toMatchObject({
      kind: 'legacy',
      label: 'Legacy source',
    })
    expect(memorySourceForEntry(entry('manual', 'replace', null, '2026-07-13T10:00:00Z', 'manual')))
      .toMatchObject({ kind: 'manual', label: 'You' })
    expect(memorySourceForEntry(entry('system', 'merge', null, '2026-07-13T10:00:00Z', 'consolidation')))
      .toMatchObject({ kind: 'cockpit', label: 'Cockpit' })
  })

  it('finds the original creator and the actual latest change regardless of input order', () => {
    const history = [
      entry('create', 'create', 'claude:session-a', '2026-07-13T10:00:00Z'),
      entry('merge', 'merge', 'codex:session-b', '2026-07-13T12:00:00Z'),
      entry('manual', 'replace', null, '2026-07-13T13:00:00Z', 'manual'),
    ]

    expect(summarizeMemoryProvenance(history, null)).toEqual({
      created: expect.objectContaining({ kind: 'claude', sessionId: 'session-a' }),
      latest: expect.objectContaining({ kind: 'manual', label: 'You' }),
    })
  })

  it('uses note frontmatter only as a creator fallback for pre-ledger memories', () => {
    expect(summarizeMemoryProvenance([], 'codex:session-from-note')).toEqual({
      created: expect.objectContaining({ kind: 'codex', sessionId: 'session-from-note' }),
      latest: expect.objectContaining({ kind: 'codex', sessionId: 'session-from-note' }),
    })
  })
})
