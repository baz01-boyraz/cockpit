import type { AuditEntry } from '@shared/domain'
import type { CaptureJob } from '@shared/memory-capture'
import { projectBrain } from '@shared/memory-ledger'
import {
  MEMORY_LIFECYCLE_POLICY,
  classifyMemoryFailure,
} from '@shared/memory-lifecycle'
import type { ReviewItem } from '@shared/memory-review'
import type { SentinelService } from './SentinelService'
import type { AuditLogService } from './AuditLogService'
import type {
  MemoryReviewChange,
  MemoryReviewService,
} from './MemoryReviewService'

type LifecycleSignalSink = Pick<SentinelService, 'report'>
type LifecycleAudit = Pick<AuditLogService, 'subscribe' | 'recent' | 'lastAt'>
type LifecycleReviews = Pick<MemoryReviewService, 'subscribe' | 'listPending'>

/**
 * Deterministic Memory health sensors. This class never reads note/transcript
 * content and never calls a model. It observes durable queue/audit/review facts,
 * applies conservative thresholds, and emits only count/category summaries to
 * Sentinel; Sentinel owns dedup, delivery, optional Flash triage, and recurrence
 * gotcha gating.
 */
export class MemoryLifecycleSentinel {
  private readonly projectCreatedAt = new Map<string, string>()
  private readonly unsubscribe: (() => void)[] = []

  constructor(
    private readonly sentinel: LifecycleSignalSink,
    private readonly audit: LifecycleAudit,
    private readonly reviews: LifecycleReviews,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.unsubscribe.push(
      this.audit.subscribe((entry) => this.onAudit(entry)),
      this.reviews.subscribe((event) => this.onReviewChange(event)),
    )
  }

  registerProject(projectId: string, createdAt: string): void {
    this.projectCreatedAt.set(projectId, createdAt)
  }

  /** Boot/read-model scan: no content leaves the owning stores. */
  scanProject(
    projectId: string,
    captureJobs: readonly CaptureJob[] = [],
    curationExpected = true,
  ): void {
    const exhausted = captureJobs.filter((job) => job.status === 'error')
    if (exhausted.length > 0) this.reportCapturePressure(projectId, exhausted)
    this.scanReviews(projectId, projectBrain(projectId))
    if (curationExpected) this.scanCurationStaleness(projectId)
  }

  /** Queue observer: retries stay quiet; the durable terminal state surfaces. */
  captureFailed(job: CaptureJob): void {
    if (job.status !== 'error') return
    this.reportCapturePressure(job.projectId, [job])
  }

  dispose(): void {
    for (const off of this.unsubscribe.splice(0)) {
      try {
        off()
      } catch {
        // Shutdown never depends on observer cleanup.
      }
    }
  }

  private onAudit(entry: AuditEntry): void {
    const projectId = entry.projectId
    if (!projectId) return
    switch (entry.actionType) {
      case 'memory.distiller_failed':
        this.reportAuditThreshold({
          projectId,
          actionType: entry.actionType,
          count: MEMORY_LIFECYCLE_POLICY.distillerFailures.count,
          windowMs: MEMORY_LIFECYCLE_POLICY.distillerFailures.windowMs,
          title: 'Memory distiller is repeatedly failing',
          summary: 'Recent capture attempts could not produce valid memory observations.',
        })
        break
      case 'memory_write_gate':
        if (entry.payloadRedacted.verdict !== 'reject') return
        this.reportAuditThreshold({
          projectId,
          actionType: entry.actionType,
          count: MEMORY_LIFECYCLE_POLICY.gateRejects.count,
          windowMs: MEMORY_LIFECYCLE_POLICY.gateRejects.windowMs,
          title: 'Memory write gate rejection spike',
          summary: 'Several automatic memory writes were rejected by the charter.',
          filter: (candidate) => candidate.payloadRedacted.verdict === 'reject',
        })
        break
      case 'memory.compliance_missing':
        this.reportAuditThreshold({
          projectId,
          actionType: entry.actionType,
          count: MEMORY_LIFECYCLE_POLICY.complianceMisses.count,
          windowMs: MEMORY_LIFECYCLE_POLICY.complianceMisses.windowMs,
          title: 'Memory contract compliance is slipping',
          summary: 'Multiple agent replies ignored the required memory evidence line.',
        })
        break
      case 'memory.curation_failed': {
        const failures = this.recent(
          projectId,
          entry.actionType,
          MEMORY_LIFECYCLE_POLICY.curationFailures.windowMs,
        )
        if (failures.length >= MEMORY_LIFECYCLE_POLICY.curationFailures.count) {
          this.report({
            projectId,
            severity: 'notice',
            title: 'Memory curation keeps failing',
            summary: `${failures.length} curation attempts failed in the last 24 hours.`,
            context: `failures=${failures.length} windowHours=24`,
          })
        } else {
          this.scanCurationStaleness(projectId)
        }
        break
      }
      default:
        break
    }
  }

  private onReviewChange(event: MemoryReviewChange): void {
    const projectId = event.originProjectId ?? projectIdFromBrain(event.brain)
    if (!projectId) return
    this.scanReviews(projectId, event.brain)
  }

  private scanReviews(projectId: string, brain: string): void {
    let pending: ReviewItem[]
    try {
      pending = this.reviews.listPending(brain)
    } catch {
      return
    }
    const conflicts = pending.filter((item) => item.kind === 'conflict').length
    const oldestMs = pending.reduce((oldest, item) => {
      const at = Date.parse(item.createdAt)
      return Number.isNaN(at) ? oldest : Math.min(oldest, at)
    }, this.now())
    const oldestDays = pending.length > 0 ? Math.floor((this.now() - oldestMs) / 86_400_000) : 0
    const context = `pending=${pending.length} conflicts=${conflicts} oldestDays=${oldestDays}`

    if (conflicts >= MEMORY_LIFECYCLE_POLICY.reviewConflicts) {
      this.report({
        projectId,
        severity: 'notice',
        title: 'Memory conflicts are accumulating',
        summary: `${conflicts} unresolved conflicts need evidence-based resolution.`,
        context,
      })
      return
    }
    if (pending.length >= MEMORY_LIFECYCLE_POLICY.reviewBacklog) {
      this.report({
        projectId,
        severity: 'notice',
        title: 'Memory review queue needs attention',
        summary: `${pending.length} memory suggestions are waiting in the review queue.`,
        context,
      })
      return
    }
    if (
      pending.length >= MEMORY_LIFECYCLE_POLICY.reviewAging.count &&
      this.now() - oldestMs >= MEMORY_LIFECYCLE_POLICY.reviewAging.ageMs
    ) {
      this.report({
        projectId,
        severity: 'notice',
        title: 'Memory review queue is aging',
        summary: `${pending.length} suggestions remain; the oldest is ${oldestDays} days old.`,
        context,
      })
    }
  }

  private scanCurationStaleness(projectId: string): void {
    const lastSuccess = this.audit.lastAt(projectId, 'memory.curation_sweep')
    const baseline = lastSuccess ?? this.projectCreatedAt.get(projectId)
    if (!baseline) return
    const at = Date.parse(baseline)
    if (Number.isNaN(at) || this.now() - at < MEMORY_LIFECYCLE_POLICY.curationStaleMs) return
    const staleDays = Math.floor((this.now() - at) / 86_400_000)
    this.report({
      projectId,
      severity: 'notice',
      title: 'Memory curation is stale',
      summary: `No successful memory curation sweep has completed for ${staleDays} days.`,
      context: `staleDays=${staleDays}`,
    })
  }

  private reportCapturePressure(projectId: string, jobs: readonly CaptureJob[]): void {
    const kinds = [...new Set(jobs.map((job) => classifyMemoryFailure(job.error ?? '')))]
    const attempts = Math.max(...jobs.map((job) => job.attempts))
    this.report({
      projectId,
      severity: 'alert',
      title: 'Memory capture stopped after repeated failures',
      summary: `${jobs.length} capture job${jobs.length === 1 ? '' : 's'} exhausted automatic retries.`,
      context: `jobs=${jobs.length} attempts=${attempts} failureKinds=${kinds.join(',')}`,
    })
  }

  private reportAuditThreshold(input: {
    projectId: string
    actionType: string
    count: number
    windowMs: number
    title: string
    summary: string
    filter?: (entry: AuditEntry) => boolean
  }): void {
    const entries = this.recent(input.projectId, input.actionType, input.windowMs).filter(
      input.filter ?? (() => true),
    )
    if (entries.length < input.count) return
    this.report({
      projectId: input.projectId,
      severity: 'notice',
      title: input.title,
      summary: input.summary,
      context: `events=${entries.length} windowMinutes=${Math.round(input.windowMs / 60_000)}`,
    })
  }

  private recent(projectId: string, actionType: string, windowMs: number): AuditEntry[] {
    const since = new Date(this.now() - windowMs).toISOString()
    try {
      return this.audit.recent(projectId, actionType, since, 100)
    } catch {
      return []
    }
  }

  private report(input: {
    projectId: string
    severity: 'notice' | 'alert'
    title: string
    summary: string
    context: string
  }): void {
    try {
      this.sentinel.report({
        ...input,
        source: 'memory-lifecycle',
      })
    } catch {
      // Sensors never endanger the queue/audit/review hot paths they observe.
    }
  }
}

function projectIdFromBrain(brain: string): string | null {
  return brain.startsWith('project:') ? brain.slice('project:'.length) || null : null
}
