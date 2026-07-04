/**
 * Review-queue domain types (docs/memory-imp.md G4). When the brain isn't sure a
 * fact should be saved — the model asked, or reconciliation found a collision —
 * the proposed change becomes a ReviewItem awaiting Baz's one-tap decision.
 * Pure types shared by the service, the IPC contract, and the mock.
 */

export const REVIEW_KINDS = ['new', 'merge', 'conflict', 'maintenance'] as const
export type ReviewKind = (typeof REVIEW_KINDS)[number]

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
  status: ReviewStatus
  createdAt: string
  resolvedAt: string | null
}

export const REVIEW_DECISIONS = ['accept', 'edit', 'discard'] as const
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number]
