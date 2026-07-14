import {
  buildNoteFromObservation,
  decideGate,
  mergeObservationIntoNote,
  type GateOutcome,
} from '@shared/memory-commit'
import { noteLifecycle, parseNote, validateNoteContent } from '@shared/memory-note-schema'
import { BAZ_GLOBAL_BRAIN, projectBrain } from '@shared/memory-ledger'
import { gateMemoryWrite } from '@shared/memory-gate'
import { reconcile, type Reconciled } from '@shared/memory-reconcile'
import type { MemoryDoc } from '@shared/memory-hub'
import type { Observation } from '@shared/memory-observation'
import { classifyMemoryFailure } from '@shared/memory-lifecycle'
import type { CaptureResult, MemoryProposal } from '@shared/memory-pipeline'
import {
  reviewOperation,
  type MemoryReviewResolutionContext,
  type ReviewDecision,
  type ReviewItem,
  type ReviewKind,
} from '@shared/memory-review'
import {
  brainForAccess,
  canAutoCleanup,
  canAutoCommit,
  delegatedConflictResolutionIssues,
  defaultTrustModeForBrain,
  type MemoryBrainScope,
} from '@shared/memory-policy'
import type { MemoryHubService } from './MemoryHubService'
import type { MemoryLedgerService } from './MemoryLedgerService'
import type { MemoryReviewService } from './MemoryReviewService'
import type { MemoryDistiller } from './MemoryDistiller'
import type { AuditLogService } from './AuditLogService'
import type { MemoryPolicyService } from './MemoryPolicyService'
import type { ResumableSessionProvider } from '@shared/domain'
import type { CaptureProcessingStage } from '@shared/memory-capture'

export interface CaptureRequest {
  projectId: string
  provider?: ResumableSessionProvider
  transcriptPath: string
  fromOffset?: number
  /** Preview only — compute proposals, write nothing. */
  dryRun?: boolean
  sessionId?: string
  /** Durable queue stage observer; omitted for manual dry-runs. */
  onStage?: (stage: CaptureProcessingStage) => void
}

/**
 * Stage 3 orchestrator (docs/memory-imp.md): distill → reconcile → gate →
 * commit|review. Every write is validated and ledgered. Ordinary uncertainty
 * fails closed; only a genuinely ambiguous replacement of protected/high-impact
 * Memory reaches the review queue. A dry run returns the same proposals but
 * touches nothing.
 *
 * Scope note: project observations route to the project hub; `scope: 'user'`
 * observations route to the configured global Baz brain. Isolated legacy tests
 * without that hub retain the old project fallback.
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
    req.onStage?.('reading')
    const sourceId = req.sessionId && req.provider ? `${req.provider}:${req.sessionId}` : req.sessionId
    const projectDocs = this.memory.listDocs(req.projectId)
    const userDocs = this.userMemory ? this.userMemory.listDocs(BAZ_GLOBAL_BRAIN) : []

    const distilled = await this.distiller.distill({
      projectId: req.projectId,
      transcriptPath: req.transcriptPath,
      fromOffset: req.fromOffset,
      projectSlugs: projectDocs.map((d) => d.name),
      userSlugs: userDocs.map((d) => d.name),
      onDistilling: () => req.onStage?.('distilling'),
    })

    if (distilled.error) {
      try {
        this.audit?.record({
          projectId: req.projectId,
          actor: 'system',
          actionType: 'memory.distiller_failed',
          summary: 'Memory distiller failed to produce valid observations',
          payload: { failureKind: classifyMemoryFailure(distilled.error) },
        })
      } catch {
        // The capture result still carries the failure when audit storage is down.
      }
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
    req.onStage?.('reconciling')
    let persistenceStarted = false

    for (const obs of distilled.observations) {
      const target = this.route(obs.scope, req.projectId, projectDocs, userDocs)
      const rec = reconcile(obs, target.docs)
      const initialGate = decideGate(obs, rec)
      const kind = this.reviewKind(rec)
      const mode = this.policy?.trustModeForBrain(target.brain) ?? defaultTrustModeForBrain(target.brain)
      let gate: GateOutcome =
        initialGate === 'commit' && !canAutoCommit(mode, kind)
          ? 'review'
          : initialGate
      // Default automation is precision-first: uncertainty is not work for the
      // owner. Only a genuinely ambiguous replacement of a protected/high-impact
      // fact reaches the inbox. Manual mode remains an explicit opt-in to review
      // every proposal.
      if (gate === 'review' && mode !== 'manual' && !this.needsOwnerDecision(obs, rec)) {
        gate = 'skip'
      }
      let proposedContent = gate === 'skip' ? null : this.buildContent(obs, rec, gate)

      if (req.dryRun) {
        proposals.push(this.proposal(obs, rec, gate, proposedContent))
        continue
      }

      const startPersistence = (): void => {
        if (persistenceStarted) return
        persistenceStarted = true
        req.onStage?.('committing')
      }

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
          gate = 'skip'
          proposedContent = null
          skipped += 1
        } else if (decision.verdict === 'review') {
          this.recordGate(req.projectId, rec.targetSlug, 'review', decision.reasons)
          if (mode === 'manual' || this.needsOwnerDecision(obs, rec)) {
            startPersistence()
            this.queueReview(req.projectId, target.brain, rec, obs, proposedContent, sourceId, decision.reasons.join('; '))
            gate = 'review'
            queued += 1
          } else {
            gate = 'skip'
            proposedContent = null
            skipped += 1
          }
        } else {
          startPersistence()
          this.commit(target.memory, target.hubId, target.brain, rec, proposedContent, sourceId)
          committed += 1
          // keep the right docs list fresh so later same-batch observations reconcile correctly
          target.docs.push({ name: rec.targetSlug, content: proposedContent, updatedAt: this.now() })
        }
      } else if (gate === 'review' && proposedContent) {
        startPersistence()
        const reason =
          initialGate === 'commit'
            ? `${mode} policy requires review for a ${kind} proposal. ${obs.reason}`
            : obs.reason
        this.queueReview(req.projectId, target.brain, rec, obs, proposedContent, sourceId, reason)
        queued += 1
      }

      proposals.push(this.proposal(obs, rec, gate, proposedContent))
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

  private proposal(
    obs: Observation,
    rec: Reconciled,
    gate: GateOutcome,
    proposedContent: string | null,
  ): MemoryProposal {
    return {
      scope: obs.scope,
      class: obs.class,
      slug: rec.targetSlug,
      title: obs.title,
      summary: obs.body,
      gate,
      reconcile: rec.decision,
      similarity: rec.similarity,
      reason: obs.reason,
      proposedContent,
    }
  }

  /**
   * Human attention is reserved for the narrow intersection the owner asked
   * for: the candidate is truly ambiguous, affects a high-impact fact, and
   * would replace existing Memory. Low-confidence new facts and routine
   * collisions fail closed (skip) instead of creating inbox debt.
   */
  private needsOwnerDecision(obs: Observation, rec: Reconciled): boolean {
    if (!rec.existingContent) return false
    if (obs.decision !== 'ask' && rec.decision !== 'conflict') return false
    if (obs.class !== 'user' && obs.class !== 'decision' && obs.class !== 'architecture') {
      return false
    }
    if (obs.scope === 'user') return true
    const lifecycle = noteLifecycle(parseNote(rec.existingContent).frontmatter)
    return (
      lifecycle.confidence === 'high' &&
      (lifecycle.authority === 'human-directive' ||
        lifecycle.authority === 'code-verified' ||
        lifecycle.authority === 'source-authority')
    )
  }

  /** Enqueue a proposal for human review (shared by the model-ask and gate-review paths). */
  private queueReview(
    originProjectId: string,
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
      originProjectId,
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

  /** Content-free resolution provenance; note bytes stay in the ledger hashes. */
  private recordReviewResolution(
    projectId: string,
    scope: MemoryBrainScope,
    item: ReviewItem,
    decision: ReviewDecision,
    resolution: MemoryReviewResolutionContext,
  ): void {
    const outcome =
      decision === 'accept' ? 'accepted' : decision === 'edit' ? 'edited' : 'discarded'
    const delegated = resolution.delegated
    this.audit?.record({
      projectId,
      actor: resolution.actor,
      actionType: 'memory.review_resolved',
      summary: `${resolution.actor === 'ai' ? 'Delegated resolver' : 'Owner'} ${outcome} a ${item.kind} memory review`,
      payload: {
        reviewId: item.id,
        scope,
        kind: item.kind,
        slug: item.slug,
        decision,
        basis: delegated?.basis ?? null,
        rationale: delegated?.rationale ?? null,
        evidence: delegated?.evidence ?? null,
      },
    })
  }

  /**
   * Autopilot's own housekeeping: apply every pending REVERSIBLE cleanup item
   * (archive / duplicate-merge maintenance) for the brain, through the same
   * stale-checked, ledgered resolution path a human decision uses. Conflicts
   * and ordinary suggestions are never touched. An item that fails (stale,
   * changed, missing) simply stays in the inbox for the owner. Returns how
   * many items were applied.
   */
  applyCleanupBacklog(projectId: string, scope: MemoryBrainScope): number {
    const brain = brainForAccess(projectId, scope)
    const mode = this.policy?.trustModeForBrain(brain) ?? defaultTrustModeForBrain(brain)
    if (!canAutoCleanup(mode)) return 0
    let applied = 0
    for (const item of this.reviews.listPendingFor(projectId, scope)) {
      if (item.kind !== 'maintenance' || reviewOperation(item) === null) continue
      try {
        this.resolveReview(projectId, scope, item.id, 'accept', undefined, { actor: 'ai' })
        applied += 1
      } catch {
        // Stale or changed cleanup stays pending — the owner decides later.
      }
    }
    return applied
  }

  /**
   * Resolve a queued review (G4). accept/edit applies the proposed write or
   * recoverable archive (validated + ledgered); discard leaves the hub untouched.
   */
  resolveReview(
    projectId: string,
    scope: MemoryBrainScope,
    reviewId: string,
    decision: ReviewDecision,
    editedContent: string | undefined,
    resolution: MemoryReviewResolutionContext,
  ): void {
    const item = this.reviews.getPendingFor(projectId, scope, reviewId)
    if (!item) throw new Error('Review item not found or not authorized for this brain.')
    if (resolution.actor !== 'user' && resolution.actor !== 'ai') {
      throw new Error('Memory review resolution requires a trusted user or AI actor.')
    }
    if (decision === 'edit' && editedContent == null) {
      throw new Error('An edit decision requires edited content.')
    }
    if (item.kind === 'conflict' && resolution.actor === 'ai') {
      const issues = delegatedConflictResolutionIssues(resolution.delegated)
      if (!this.audit) issues.push('delegated conflict audit sink is unavailable')
      if (issues.length > 0) {
        throw new Error(`Delegated conflict resolution refused: ${issues.join('; ')}`)
      }
    }

    if (decision === 'discard') {
      if (!this.reviews.markResolvedFor(projectId, scope, reviewId, 'discarded')) {
        throw new Error('Review item changed before it could be resolved.')
      }
      this.recordReviewResolution(projectId, scope, item, decision, resolution)
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
      this.recordReviewResolution(projectId, scope, item, decision, resolution)
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
      action:
        item.kind === 'conflict'
          ? 'replace'
          : item.kind === 'merge' || operation === 'merge'
            ? 'merge'
            : 'create',
      gate:
        item.kind === 'maintenance'
          ? 'consolidation'
          : resolution.actor === 'ai'
            ? 'delegated'
            : 'asked',
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
    this.recordReviewResolution(projectId, scope, item, decision, resolution)
  }
}
