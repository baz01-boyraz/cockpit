import {
  buildNoteFromObservation,
  decideGate,
  mergeObservationIntoNote,
  type GateOutcome,
} from '@shared/memory-commit'
import { validateNoteContent } from '@shared/memory-note-schema'
import { BAZ_GLOBAL_BRAIN, projectBrain } from '@shared/memory-ledger'
import { reconcile, type Reconciled } from '@shared/memory-reconcile'
import type { MemoryDoc } from '@shared/memory-hub'
import type { Observation } from '@shared/memory-observation'
import type { CaptureResult, MemoryProposal } from '@shared/memory-pipeline'
import type { ReviewDecision } from '@shared/memory-review'
import type { MemoryHubService } from './MemoryHubService'
import type { MemoryLedgerService } from './MemoryLedgerService'
import type { MemoryReviewService } from './MemoryReviewService'
import type { MemoryDistiller } from './MemoryDistiller'

export interface CaptureRequest {
  projectId: string
  transcriptPath: string
  fromOffset?: number
  /** Preview only — compute proposals, write nothing. */
  dryRun?: boolean
  sessionId?: string
  model?: string
}

/**
 * Stage 3 orchestrator (docs/memory-imp.md): distill → reconcile → gate →
 * commit|review. Every write is validated and ledgered; a conflict or an unsure
 * model decision routes to the review queue instead of disk. A dry run returns
 * the same proposals but touches nothing.
 *
 * Scope note: this operates on the PROJECT brain. `scope: 'user'` facts are
 * still saved here (tagged `baz` by the commit builder) so nothing is lost; the
 * Phase 6 global brain will relocate them. No fact is dropped for lack of a home.
 */
export class MemoryPipeline {
  constructor(
    private readonly memory: MemoryHubService,
    private readonly ledger: MemoryLedgerService,
    private readonly reviews: MemoryReviewService,
    private readonly distiller: MemoryDistiller,
    private readonly now: () => string = () => new Date().toISOString(),
    /** The cross-project Baz brain (Phase 6). When set, user-scope facts route here. */
    private readonly userMemory?: MemoryHubService,
  ) {}

  /** Which hub, docs, brain-key, and hub-id a given scope's fact belongs to. */
  private route(
    scope: 'project' | 'user',
    projectId: string,
    projectDocs: MemoryDoc[],
    userDocs: MemoryDoc[],
  ): { memory: MemoryHubService; docs: MemoryDoc[]; brain: string; hubId: string } {
    if (scope === 'user' && this.userMemory) {
      return { memory: this.userMemory, docs: userDocs, brain: BAZ_GLOBAL_BRAIN, hubId: BAZ_GLOBAL_BRAIN }
    }
    return { memory: this.memory, docs: projectDocs, brain: projectBrain(projectId), hubId: projectId }
  }

  async capture(req: CaptureRequest): Promise<CaptureResult> {
    const projectDocs = this.memory.listDocs(req.projectId)
    const userDocs = this.userMemory ? this.userMemory.listDocs(BAZ_GLOBAL_BRAIN) : []

    const distilled = await this.distiller.distill({
      projectId: req.projectId,
      transcriptPath: req.transcriptPath,
      fromOffset: req.fromOffset,
      projectSlugs: projectDocs.map((d) => d.name),
      userSlugs: userDocs.map((d) => d.name),
      model: req.model,
    })

    if (distilled.error) {
      return {
        proposals: [],
        committed: 0,
        queued: 0,
        skipped: 0,
        nextOffset: distilled.nextOffset,
        dryRun: !!req.dryRun,
        error: distilled.error,
      }
    }

    const proposals: MemoryProposal[] = []
    let committed = 0
    let queued = 0
    let skipped = 0

    for (const obs of distilled.observations) {
      const target = this.route(obs.scope, req.projectId, projectDocs, userDocs)
      const rec = reconcile(obs, target.docs)
      const gate = decideGate(obs, rec)
      const proposedContent = gate === 'skip' ? null : this.buildContent(obs, rec, gate)

      proposals.push({
        scope: obs.scope,
        class: obs.class,
        slug: rec.targetSlug,
        title: obs.title,
        gate,
        reconcile: rec.decision,
        similarity: rec.similarity,
        reason: obs.reason,
        proposedContent,
      })

      if (req.dryRun) continue

      if (gate === 'skip') {
        skipped += 1
      } else if (gate === 'commit' && proposedContent) {
        this.commit(target.memory, target.hubId, target.brain, rec, proposedContent, req.sessionId)
        committed += 1
        // keep the right docs list fresh so later same-batch observations reconcile correctly
        target.docs.push({ name: rec.targetSlug, content: proposedContent, updatedAt: this.now() })
      } else if (gate === 'review' && proposedContent) {
        this.reviews.create({
          brain: target.brain,
          kind: rec.decision === 'conflict' ? 'conflict' : rec.decision === 'merge' ? 'merge' : 'new',
          slug: rec.targetSlug,
          title: obs.title,
          proposedContent,
          reason: obs.reason,
          existingContent: rec.existingContent,
          sourceId: req.sessionId ?? null,
        })
        queued += 1
      }
    }

    return {
      proposals,
      committed,
      queued,
      skipped,
      nextOffset: distilled.nextOffset,
      dryRun: !!req.dryRun,
    }
  }

  /** Build the note bytes for a commit/review proposal (gate picks the note's gate). */
  private buildContent(obs: Observation, rec: Reconciled, gate: GateOutcome): string {
    const noteGate = gate === 'commit' ? 'save' : 'asked'
    if (rec.decision === 'merge' && rec.existingContent) {
      return mergeObservationIntoNote(rec.existingContent, obs, { now: this.now(), gate: noteGate }).content
    }
    return buildNoteFromObservation(obs, { now: this.now(), gate: noteGate }).content
  }

  /** Validate, write atomically, and ledger a committed note (G3/G7). */
  private commit(
    memory: MemoryHubService,
    hubId: string,
    brain: string,
    rec: Reconciled,
    content: string,
    sessionId?: string,
  ): void {
    const check = validateNoteContent(rec.targetSlug, content)
    if (!check.ok) {
      throw new Error(`Refusing to write invalid note "${rec.targetSlug}": ${check.errors.join('; ')}`)
    }
    const before = rec.existingContent
    memory.write(hubId, rec.targetSlug, content)
    this.ledger.record({
      brain,
      noteSlug: rec.targetSlug,
      action: rec.decision === 'merge' ? 'merge' : 'create',
      gate: 'save',
      sourceId: sessionId ?? null,
      contentBefore: before,
      contentAfter: content,
    })
  }

  /** The hub + id a review's brain writes to (project hub, or the global Baz brain). */
  private hubForBrain(brain: string, projectId: string): { memory: MemoryHubService; hubId: string } {
    if (brain === BAZ_GLOBAL_BRAIN && this.userMemory) {
      return { memory: this.userMemory, hubId: BAZ_GLOBAL_BRAIN }
    }
    return { memory: this.memory, hubId: projectId }
  }

  /**
   * Resolve a queued review (G4). accept/edit writes the proposal (validated +
   * ledgered), discard leaves the hub untouched. Returns the resolved item's id.
   */
  resolveReview(projectId: string, reviewId: string, decision: ReviewDecision, editedContent?: string): void {
    const item = this.reviews.get(reviewId)
    if (!item) throw new Error('Review item not found.')
    if (item.status !== 'pending') throw new Error('Review item is already resolved.')

    if (decision === 'discard') {
      this.reviews.markResolved(reviewId, 'discarded')
      return
    }

    const content = decision === 'edit' && editedContent != null ? editedContent : item.proposedContent
    const check = validateNoteContent(item.slug, content)
    if (!check.ok) {
      throw new Error(`Refusing to write invalid note "${item.slug}": ${check.errors.join('; ')}`)
    }
    const { memory, hubId } = this.hubForBrain(item.brain, projectId)
    const before = memory.read(hubId, item.slug)?.content ?? null
    memory.write(hubId, item.slug, content)
    this.ledger.record({
      brain: item.brain,
      noteSlug: item.slug,
      action: item.kind === 'merge' ? 'merge' : 'create',
      gate: 'asked',
      sourceId: item.sourceId,
      contentBefore: before,
      contentAfter: content,
    })
    // A consolidation merge folds a duplicate into `slug`; drop the twin now.
    if (item.alsoTrash && item.alsoTrash !== item.slug) {
      const dropped = memory.read(hubId, item.alsoTrash)?.content ?? null
      if (dropped !== null) {
        memory.trash(hubId, item.alsoTrash)
        this.ledger.record({
          brain: item.brain,
          noteSlug: item.alsoTrash,
          action: 'trash',
          gate: 'consolidation',
          sourceId: item.sourceId,
          contentBefore: dropped,
          contentAfter: null,
        })
      }
    }
    this.reviews.markResolved(reviewId, decision === 'edit' ? 'edited' : 'accepted')
  }
}
