import { createHash, randomUUID } from 'node:crypto'
import type { LedgerAction, LedgerEntry, LedgerGate } from '@shared/memory-ledger'
import type { Db } from '../db/Database'

interface LedgerRow {
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

const toEntry = (r: LedgerRow): LedgerEntry => ({
  id: r.id,
  brain: r.brain,
  noteSlug: r.note_slug,
  action: r.action as LedgerAction,
  gate: r.gate as LedgerGate,
  sourceId: r.source_id,
  hashBefore: r.hash_before,
  hashAfter: r.hash_after,
  createdAt: r.created_at,
})

export interface LedgerInput {
  brain: string
  noteSlug: string
  action: LedgerAction
  gate: LedgerGate
  sourceId?: string | null
  contentBefore?: string | null
  contentAfter?: string | null
}

/**
 * Append-only provenance for the memory brain (docs/memory-imp.md, G7). Every
 * write/rename/trash/restore the brain performs is recorded here with content
 * hashes, so a note is always traceable and a `revert` can find the prior state.
 * Never updates or deletes a row — history is immutable.
 */
export class MemoryLedgerService {
  constructor(private readonly db: Db) {}

  /** SHA-256 of a note's content — the identity used to detect real changes. */
  static hash(content: string | null | undefined): string | null {
    if (content == null) return null
    return createHash('sha256').update(content, 'utf8').digest('hex')
  }

  record(input: LedgerInput): LedgerEntry {
    const entry: LedgerEntry = {
      id: randomUUID(),
      brain: input.brain,
      noteSlug: input.noteSlug,
      action: input.action,
      gate: input.gate,
      sourceId: input.sourceId ?? null,
      hashBefore: MemoryLedgerService.hash(input.contentBefore),
      hashAfter: MemoryLedgerService.hash(input.contentAfter),
      createdAt: new Date().toISOString(),
    }
    this.db
      .prepare(
        `INSERT INTO memory_ledger
           (id, brain, note_slug, action, gate, source_id, hash_before, hash_after, created_at)
         VALUES (@id, @brain, @noteSlug, @action, @gate, @sourceId, @hashBefore, @hashAfter, @createdAt)`,
      )
      .run(entry)
    return entry
  }

  /** History for a brain, most recent first. Filter to one note when given. */
  list(brain: string, noteSlug?: string): LedgerEntry[] {
    const rows = noteSlug
      ? this.db
          .prepare(
            'SELECT * FROM memory_ledger WHERE brain = ? AND note_slug = ? ORDER BY created_at DESC, rowid DESC',
          )
          .all(brain, noteSlug)
      : this.db
          .prepare('SELECT * FROM memory_ledger WHERE brain = ? ORDER BY created_at DESC, rowid DESC')
          .all(brain)
    return (rows as LedgerRow[]).map(toEntry)
  }
}
