import { randomUUID } from 'node:crypto'
import type { ReviewItem, ReviewKind, ReviewOperation } from '@shared/memory-review'
import { brainForAccess, type MemoryBrainScope } from '@shared/memory-policy'
import type { Db } from '../db/Database'

interface ReviewRow {
  id: string
  brain: string
  kind: string
  slug: string
  payload: string
  status: string
  created_at: string
  resolved_at: string | null
}

interface Payload {
  title: string
  proposedContent: string
  reason: string
  existingContent: string | null
  sourceId: string | null
  alsoTrash?: string | null
  operation?: ReviewOperation | null
  alsoTrashContent?: string | null
}

function toItem(r: ReviewRow): ReviewItem {
  const p = JSON.parse(r.payload) as Payload
  return {
    id: r.id,
    brain: r.brain,
    kind: r.kind as ReviewKind,
    slug: r.slug,
    title: p.title,
    proposedContent: p.proposedContent,
    reason: p.reason,
    existingContent: p.existingContent,
    sourceId: p.sourceId,
    alsoTrash: p.alsoTrash ?? null,
    operation: p.operation ?? null,
    alsoTrashContent: p.alsoTrashContent ?? null,
    status: r.status as ReviewItem['status'],
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  }
}

export interface CreateReviewInput {
  brain: string
  kind: ReviewKind
  slug: string
  title: string
  proposedContent: string
  reason: string
  existingContent?: string | null
  sourceId?: string | null
  alsoTrash?: string | null
  operation?: ReviewOperation | null
  alsoTrashContent?: string | null
}

/**
 * Persistence for the review queue (docs/memory-imp.md G4). Pure storage — it
 * never writes notes; the pipeline applies an accepted proposal and then marks
 * the row resolved. A discarded proposal simply never touches the hub.
 */
export class MemoryReviewService {
  constructor(private readonly db: Db) {}

  create(input: CreateReviewInput): ReviewItem {
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    const payload: Payload = {
      title: input.title,
      proposedContent: input.proposedContent,
      reason: input.reason,
      existingContent: input.existingContent ?? null,
      sourceId: input.sourceId ?? null,
      alsoTrash: input.alsoTrash ?? null,
      operation: input.operation ?? null,
      alsoTrashContent: input.alsoTrashContent ?? null,
    }
    this.db
      .prepare(
        `INSERT INTO memory_review (id, brain, kind, slug, payload, status, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)`,
      )
      .run(id, input.brain, input.kind, input.slug, JSON.stringify(payload), createdAt)
    return toItem({
      id,
      brain: input.brain,
      kind: input.kind,
      slug: input.slug,
      payload: JSON.stringify(payload),
      status: 'pending',
      created_at: createdAt,
      resolved_at: null,
    })
  }

  listPending(brain: string): ReviewItem[] {
    const rows = this.db
      .prepare("SELECT * FROM memory_review WHERE brain = ? AND status = 'pending' ORDER BY created_at ASC")
      .all(brain)
    return (rows as ReviewRow[]).map(toItem)
  }

  /** External-facing list: target brain is derived, never caller-supplied. */
  listPendingFor(originProjectId: string, scope: MemoryBrainScope): ReviewItem[] {
    return this.listPending(brainForAccess(originProjectId, scope))
  }

  get(id: string): ReviewItem | null {
    const row = this.db.prepare('SELECT * FROM memory_review WHERE id = ?').get(id)
    return row ? toItem(row as ReviewRow) : null
  }

  /** Return one pending item only when it belongs to the authorized brain. */
  getPendingFor(
    originProjectId: string,
    scope: MemoryBrainScope,
    id: string,
  ): ReviewItem | null {
    const brain = brainForAccess(originProjectId, scope)
    const row = this.db
      .prepare(
        "SELECT * FROM memory_review WHERE id = ? AND brain = ? AND status = 'pending'",
      )
      .get(id, brain)
    return row ? toItem(row as ReviewRow) : null
  }

  /** Mark a review resolved with its final status ('accepted'|'edited'|'discarded'). */
  markResolved(id: string, status: ReviewItem['status']): void {
    this.db
      .prepare('UPDATE memory_review SET status = ?, resolved_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id)
  }

  /** Scope-checked resolution. False means missing, foreign, or no longer pending. */
  markResolvedFor(
    originProjectId: string,
    scope: MemoryBrainScope,
    id: string,
    status: ReviewItem['status'],
  ): boolean {
    const brain = brainForAccess(originProjectId, scope)
    const result = this.db
      .prepare(
        "UPDATE memory_review SET status = ?, resolved_at = ? WHERE id = ? AND brain = ? AND status = 'pending'",
      )
      .run(status, new Date().toISOString(), id, brain)
    return result.changes === 1
  }
}
