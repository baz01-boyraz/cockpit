import { describe, expect, it } from 'vitest'
import { MemoryLedgerService } from '../electron/main/services/MemoryLedgerService'
import type { Db } from '../electron/main/db/Database'
import { projectBrain } from '@shared/memory-ledger'

interface Row {
  id: string
  brain: string
  note_slug: string
  action: string
  gate: string
  source_id: string | null
  hash_before: string | null
  hash_after: string | null
  created_at: string
}

/** Stateful in-memory stand-in for the memory_ledger statements. */
function makeLedgerDb() {
  const rows: Row[] = []
  const fake = {
    prepare(sql: string) {
      return {
        // The service passes a camelCase entry to named params (@noteSlug…);
        // the real DB maps those to snake_case columns — emulate that mapping.
        run: (e: Record<string, string | null>) => {
          if (sql.includes('INSERT INTO memory_ledger')) {
            rows.push({
              id: e.id as string,
              brain: e.brain as string,
              note_slug: e.noteSlug as string,
              action: e.action as string,
              gate: e.gate as string,
              source_id: e.sourceId,
              hash_before: e.hashBefore,
              hash_after: e.hashAfter,
              created_at: e.createdAt as string,
            })
          }
          return { changes: 1 }
        },
        all: (...args: unknown[]) => {
          let out = rows.slice()
          if (sql.includes('note_slug = ?')) {
            out = out.filter((r) => r.brain === args[0] && r.note_slug === args[1])
          } else {
            out = out.filter((r) => r.brain === args[0])
          }
          // most recent first — the rows were pushed in insertion order
          return out.reverse()
        },
        get: () => undefined,
      }
    },
  }
  return { db: fake as unknown as Db, rows }
}

describe('MemoryLedgerService.hash', () => {
  it('is stable for identical content', () => {
    expect(MemoryLedgerService.hash('hello')).toBe(MemoryLedgerService.hash('hello'))
  })

  it('differs for different content', () => {
    expect(MemoryLedgerService.hash('a')).not.toBe(MemoryLedgerService.hash('b'))
  })

  it('is null for null/undefined (a create has no before-state)', () => {
    expect(MemoryLedgerService.hash(null)).toBeNull()
    expect(MemoryLedgerService.hash(undefined)).toBeNull()
  })
})

describe('MemoryLedgerService.record', () => {
  it('records before/after hashes and echoes a complete entry', () => {
    const { db } = makeLedgerDb()
    const ledger = new MemoryLedgerService(db)
    const entry = ledger.record({
      brain: projectBrain('p1'),
      noteSlug: 'router-decision',
      action: 'create',
      gate: 'save',
      contentBefore: null,
      contentAfter: 'the fact',
    })
    expect(entry.id).toBeTruthy()
    expect(entry.brain).toBe('project:p1')
    expect(entry.hashBefore).toBeNull()
    expect(entry.hashAfter).toBe(MemoryLedgerService.hash('the fact'))
    expect(entry.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('MemoryLedgerService.list', () => {
  it('returns a brain history most-recent-first, filterable by note', () => {
    const { db } = makeLedgerDb()
    const ledger = new MemoryLedgerService(db)
    ledger.record({ brain: 'project:p1', noteSlug: 'a', action: 'create', gate: 'save', contentAfter: '1' })
    ledger.record({ brain: 'project:p1', noteSlug: 'b', action: 'create', gate: 'save', contentAfter: '2' })
    ledger.record({ brain: 'project:p1', noteSlug: 'a', action: 'merge', gate: 'consolidation', contentAfter: '3' })

    const all = ledger.list('project:p1')
    expect(all).toHaveLength(3)
    expect(all[0].action).toBe('merge') // most recent

    const onlyA = ledger.list('project:p1', 'a')
    expect(onlyA.map((e) => e.action)).toEqual(['merge', 'create'])
  })
})
