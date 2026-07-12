/**
 * Review-queue domain types (docs/memory-imp.md G4). When the brain isn't sure a
 * fact should be saved — the model asked, or reconciliation found a collision —
 * the proposed change becomes a ReviewItem awaiting Baz's one-tap decision.
 * Pure types shared by the service, the IPC contract, and the mock.
 */

export const REVIEW_KINDS = ['new', 'merge', 'conflict', 'maintenance'] as const
export type ReviewKind = (typeof REVIEW_KINDS)[number]

export const REVIEW_OPERATIONS = ['archive', 'merge'] as const
export type ReviewOperation = (typeof REVIEW_OPERATIONS)[number]

export const REVIEW_STATUSES = ['pending', 'accepted', 'edited', 'discarded'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export interface ReviewItem {
  id: string
  /** 'project:<id>' or 'baz-global'. */
  brain: string
  kind: ReviewKind
  slug: string
  title: string
  /** The full note content that will be written if accepted. */
  proposedContent: string
  /** One-line explanation of why this is being asked rather than auto-saved. */
  reason: string
  /** The existing note's content for a merge/conflict, else null. */
  existingContent: string | null
  /** The capture source (transcript session) this came from, if any. */
  sourceId: string | null
  /** On accept, also soft-delete this slug (a merge's dropped duplicate). */
  alsoTrash: string | null
  /** Explicit cleanup operation. Optional so queued rows from older builds remain readable. */
  operation?: ReviewOperation | null
  /** Original content of the duplicate, used to reject a stale cleanup safely. */
  alsoTrashContent?: string | null
  status: ReviewStatus
  createdAt: string
  resolvedAt: string | null
}

export const REVIEW_DECISIONS = ['accept', 'edit', 'discard'] as const
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number]

/**
 * Resolve a review's cleanup operation, including rows queued before the
 * explicit `operation` field existed. The legacy fallback is deliberately
 * narrow: ordinary merge/conflict reviews must never become maintenance work.
 */
export function reviewOperation(
  item: Pick<ReviewItem, 'kind' | 'title' | 'reason' | 'alsoTrash' | 'operation'>,
): ReviewOperation | null {
  if (item.operation === 'archive' || item.operation === 'merge') return item.operation
  if (item.kind !== 'maintenance') return null
  if (item.alsoTrash) return 'merge'
  if (/^archive stale note:/i.test(item.title)) return 'archive'
  if (/^curation\s*[—-]\s*archive:/i.test(item.reason)) return 'archive'
  return null
}
