import {
  buildNoteFromObservation,
  decideGate,
  mergeObservationIntoNote,
  type GateOutcome,
} from '@shared/memory-commit'
import { validateNoteContent } from '@shared/memory-note-schema'
import { BAZ_GLOBAL_BRAIN, projectBrain } from '@shared/memory-ledger'
import { gateMemoryWrite } from '@shared/memory-gate'
import { reconcile, type Reconciled } from '@shared/memory-reconcile'
import type { MemoryDoc } from '@shared/memory-hub'
import type { Observation } from '@shared/memory-observation'
import type { CaptureResult, MemoryProposal } from '@shared/memory-pipeline'
import { reviewOperation, type ReviewDecision, type ReviewKind } from '@shared/memory-review'
import {
  brainForAccess,
  canAutoCommit,
  defaultTrustModeForBrain,
  type MemoryBrainScope,
} from '@shared/memory-policy'
import type { MemoryHubService } from './MemoryHubService'
import type { MemoryLedgerService } from './MemoryLedgerService'
import type { MemoryReviewService } from './MemoryReviewService'
import type { MemoryDistiller } from './MemoryDistiller'
import type { AuditLogService } from './AuditLogService'
import type { MemoryPolicyService } from './MemoryPolicyService'

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
    /** Faz C: gate outcome counters (accept/review/reject, no content). Optional. */
    private readonly audit?: Pick<AuditLogService, 'record'>,
    /** Brain-scoped trust policy; optional keeps isolated tests/back-compat safe. */
    private readonly policy?: Pick<MemoryPolicyService, 'trustModeForBrain'>,
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
      const initialGate = decideGate(obs, rec)
      const kind = this.reviewKind(rec)
      const mode = this.policy?.trustModeForBrain(target.brain) ?? defaultTrustModeForBrain(target.brain)
      const gate =
        initialGate === 'commit' && !canAutoCommit(mode, kind)
          ? 'review'
          : initialGate
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
        // Faz C charter gate — a last, cautious pass over a would-be auto-commit.
        // It can only make the pipeline MORE careful: a secret-shaped note is
        // dropped (never persisted), a vague/oversized one downgrades to review.
        const decision = gateMemoryWrite({
          name: rec.targetSlug,
          content: proposedContent,
          justification: {
            sevenDayScenario: obs.reason,
            dedupChecked: rec.decision === 'merge' ? 'updates-existing' : 'no-overlap',
            targetNote: rec.targetSlug,
            evidence: obs.body,
          },
          existingNames: target.docs.map((d) => d.name),
        })
        if (decision.verdict === 'reject') {
          this.recordGate(req.projectId, rec.targetSlug, 'reject', decision.reasons)
          skipped += 1
        } else if (decision.verdict === 'review') {
          this.queueReview(target.brain, rec, obs, proposedContent, req.sessionId, decision.reasons.join('; '))
          this.recordGate(req.projectId, rec.targetSlug, 'review', decision.reasons)
          queued += 1
        } else {
          this.commit(target.memory, target.hubId, target.brain, rec, proposedContent, req.sessionId)
          committed += 1
          // keep the right docs list fresh so later same-batch observations reconcile correctly
          target.docs.push({ name: rec.targetSlug, content: proposedContent, updatedAt: this.now() })
        }
      } else if (gate === 'review' && proposedContent) {
        const reason =
          initialGate === 'commit'
            ? `${mode} policy requires review for a ${kind} proposal. ${obs.reason}`
            : obs.reason
        this.queueReview(target.brain, rec, obs, proposedContent, req.sessionId, reason)
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

  /** Enqueue a proposal for human review (shared by the model-ask and gate-review paths). */
  private queueReview(
    brain: string,
    rec: Reconciled,
    obs: Observation,
    proposedContent: string,
    sessionId: string | undefined,
    reason: string,
  ): void {
    this.reviews.create({
      brain,
      kind: this.reviewKind(rec),
      slug: rec.targetSlug,
      title: obs.title,
      proposedContent,
      reason,
      existingContent: rec.existingContent,
      sourceId: sessionId ?? null,
    })
  }

  private reviewKind(rec: Reconciled): ReviewKind {
    if (rec.decision === 'conflict') return 'conflict'
    if (rec.decision === 'merge') return 'merge'
    return 'new'
  }

  /** Record a gate outcome for the junk-rate metric (stats only, never note content). */
  private recordGate(
    projectId: string,
    slug: string,
    verdict: 'review' | 'reject',
    reasons: string[],
  ): void {
    this.audit?.record({
      projectId,
      actor: 'system',
      actionType: 'memory_write_gate',
      summary: `auto-capture write ${verdict === 'reject' ? 'rejected' : 'routed to review'} by charter`,
      payload: { slug, verdict, reasons },
    })
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
  private hubForBrain(
    brain: string,
    projectId: string,
    scope: MemoryBrainScope,
  ): { memory: MemoryHubService; hubId: string } {
    const authorizedBrain = brainForAccess(projectId, scope)
    if (brain !== authorizedBrain) throw new Error('Review item is not authorized for this brain.')
    if (scope === 'global') {
      if (!this.userMemory) throw new Error('Global Memory brain is unavailable.')
      return { memory: this.userMemory, hubId: BAZ_GLOBAL_BRAIN }
    }
    return { memory: this.memory, hubId: projectId }
  }

  /**
   * Resolve a queued review (G4). accept/edit writes the proposal (validated +
   * ledgered), discard leaves the hub untouched. Returns the resolved item's id.
   */
  resolveReview(
    projectId: string,
    scope: MemoryBrainScope,
    reviewId: string,
    decision: ReviewDecision,
    editedContent?: string,
  ): void {
    const item = this.reviews.getPendingFor(projectId, scope, reviewId)
    if (!item) throw new Error('Review item not found or not authorized for this brain.')

    if (decision === 'discard') {
      if (!this.reviews.markResolvedFor(projectId, scope, reviewId, 'discarded')) {
        throw new Error('Review item changed before it could be resolved.')
      }
      return
    }

    const operation = reviewOperation(item)
    const { memory, hubId } = this.hubForBrain(item.brain, projectId, scope)
    const before = memory.read(hubId, item.slug)?.content ?? null
    if (before !== item.existingContent) {
      throw new Error('This memory changed since the review was created. Dismiss it and review the latest version.')
    }

    if (item.alsoTrash && item.alsoTrashContent != null) {
      const duplicate = memory.read(hubId, item.alsoTrash)?.content ?? null
      if (duplicate !== item.alsoTrashContent) {
        throw new Error('A duplicate memory changed since cleanup was proposed. Run cleanup again before combining it.')
      }
    }

    if (operation === 'archive') {
      if (decision === 'edit') throw new Error('Archive cleanup cannot be edited.')
      if (before === null) throw new Error('This memory is no longer active.')
      memory.trash(hubId, item.slug)
      this.ledger.record({
        brain: item.brain,
        noteSlug: item.slug,
        action: 'trash',
        gate: 'consolidation',
        sourceId: item.sourceId,
        contentBefore: before,
        contentAfter: null,
      })
      if (!this.reviews.markResolvedFor(projectId, scope, reviewId, 'accepted')) {
        throw new Error('Review item changed before it could be resolved.')
      }
      return
    }

    const content = decision === 'edit' && editedContent != null ? editedContent : item.proposedContent
    const check = validateNoteContent(item.slug, content)
    if (!check.ok) {
      throw new Error(`Refusing to write invalid note "${item.slug}": ${check.errors.join('; ')}`)
    }
    memory.write(hubId, item.slug, content)
    this.ledger.record({
      brain: item.brain,
      noteSlug: item.slug,
      action: item.kind === 'merge' || operation === 'merge' ? 'merge' : 'create',
      gate: item.kind === 'maintenance' ? 'consolidation' : 'asked',
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
    if (
      !this.reviews.markResolvedFor(
        projectId,
        scope,
        reviewId,
        decision === 'edit' ? 'edited' : 'accepted',
      )
    ) {
      throw new Error('Review item changed before it could be resolved.')
    }
  }
}
