import { analyzeConsolidation, mergeDuplicate, type ConsolidationResult } from '@shared/memory-consolidate'
import { projectBrain } from '@shared/memory-ledger'
import type { MemoryHubService } from './MemoryHubService'
import type { MemoryReviewService } from './MemoryReviewService'

/**
 * Consolidation ("sleep") pass (docs/memory-imp.md Phase 5, G5). Snapshots the
 * hub first (G7 — a bad clean-up is one restore away), scans for maintenance
 * work, and queues duplicate-note merges as review items so Baz approves them
 * like any other change. Oversized, in-note repetition, and dangling-link
 * findings are report-only; they are never auto-mutated or turned into fresh
 * observations. Read-mostly and idempotent — running it twice just
 * re-queues the same proposals (deduped by the review UI on resolve).
 */
export class MemoryConsolidator {
  constructor(
    private readonly memory: MemoryHubService,
    private readonly reviews: MemoryReviewService,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  consolidate(projectId: string): ConsolidationResult {
    const snapshot = this.memory.snapshot(projectId)
    const docs = this.memory.listDocs(projectId)
    const report = analyzeConsolidation(docs)
    const brain = projectBrain(projectId)

    let queued = 0
    const pending = new Set(this.reviews.listPending(brain).map((r) => `${r.slug}|${r.alsoTrash ?? ''}`))

    for (const dup of report.duplicates) {
      const [keepSlug, dropSlug] = dup.slugs
      const dedupeKey = `${keepSlug}|${dropSlug}`
      if (pending.has(dedupeKey)) continue // already waiting on Baz — don't pile up
      const keep = docs.find((d) => d.name === keepSlug)
      const drop = docs.find((d) => d.name === dropSlug)
      if (!keep || !drop) continue
      const merged = mergeDuplicate(keepSlug, keep.content, dropSlug, drop.content, this.now())
      this.reviews.create({
        brain,
        kind: 'maintenance',
        slug: keepSlug,
        title: `Merge duplicate: ${dropSlug} → ${keepSlug}`,
        proposedContent: merged,
        reason: `These two notes are ${Math.round(dup.similarity * 100)}% similar — merge and drop the duplicate.`,
        existingContent: keep.content,
        alsoTrash: dropSlug,
      })
      queued += 1
    }

    return { report, queued, snapshotId: snapshot.id }
  }
}
