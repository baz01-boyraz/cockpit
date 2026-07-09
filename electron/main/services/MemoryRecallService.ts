import { randomUUID } from 'node:crypto'
import { HUB_POINTER_CAP } from '@shared/swarm-worker'
import type { Db } from '../db/Database'

/**
 * Which selection surface produced a recall. The two hooks that pick the hub
 * notes reaching a prompt: the swarm worker's opening brief and the council's
 * spec-mode memory-pointer block.
 */
export type RecallSurface = 'swarm_worker' | 'council_spec'

/**
 * Recall telemetry (Track G2, docs/plans/outcome-tracking-plan.md). The
 * `memory_ledger` (V7) records WRITES; this records RECALLS — the fact that a
 * note was selected into a prompt. That selection *is* the recall event, so the
 * two ranking hooks feed this best-effort.
 *
 * The overriding contract: **recording a recall must never endanger a spawn or a
 * council run.** Every method is fully wrapped and can never throw — a bad input,
 * a closed DB, or a write failure degrades to "nothing recorded" / "nothing
 * recalled", never a crash on the hot path.
 */
export class MemoryRecallService {
  constructor(private readonly db: Db) {}

  /**
   * Record a single bounded batch of recalls for `brain` at `surface`. Slugs are
   * de-duped defensively (a ranker never repeats, but the write must be idempotent
   * within one event) and hard-capped at {@link HUB_POINTER_CAP} rows so a single
   * event can never write an unbounded batch. All inserts share one timestamp and
   * run inside one transaction. Never throws.
   */
  record(brain: string, slugs: readonly string[], surface: RecallSurface): void {
    try {
      if (typeof brain !== 'string' || brain.length === 0) return
      if (!Array.isArray(slugs)) return
      const clean = Array.from(
        new Set(
          slugs.filter((s): s is string => typeof s === 'string' && s.length > 0),
        ),
      ).slice(0, HUB_POINTER_CAP)
      if (clean.length === 0) return

      const createdAt = new Date().toISOString()
      const insert = this.db.prepare(
        `INSERT INTO memory_recalls (id, brain, note_slug, surface, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      const writeBatch = this.db.transaction((rows: readonly string[]) => {
        for (const slug of rows) insert.run(randomUUID(), brain, slug, surface, createdAt)
      })
      writeBatch(clean)
    } catch {
      // A recall is telemetry, not correctness — its failure must be invisible.
    }
  }

  /**
   * How many times each note in `brain` was recalled at or after `sinceIso`
   * (inclusive lower bound — a recall stamped exactly at the cutoff counts).
   * Returns a `slug → count` map; an unknown/empty brain or a read error yields an
   * empty map, never a throw. This is the 7-day "earns its keep" query.
   */
  recalledSince(brain: string, sinceIso: string): Map<string, number> {
    const counts = new Map<string, number>()
    try {
      if (typeof brain !== 'string' || brain.length === 0) return counts
      if (typeof sinceIso !== 'string' || sinceIso.length === 0) return counts
      const rows = this.db
        .prepare(
          `SELECT note_slug AS slug, COUNT(*) AS count
             FROM memory_recalls
            WHERE brain = ? AND created_at >= ?
            GROUP BY note_slug`,
        )
        .all(brain, sinceIso) as { slug: string; count: number }[]
      for (const row of rows) counts.set(row.slug, row.count)
    } catch {
      // A read failure degrades to "nothing recalled" — never a crash.
    }
    return counts
  }
}
