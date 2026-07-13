import { formatCompletionSummary, type CompletionReport } from '@shared/completion-report'
import {
  buildCompletionEvidence,
  deterministicCompletionTriage,
  parseCompletionEvidence,
  type CompletionEvidence,
} from '@shared/swarm-completion'
import type { SentinelSignal, SentinelTriage } from '@shared/sentinel'
import type { CockpitEvents } from '../events'
import type { SentinelReportInput } from './SentinelService'

const OUTPUT_TAIL_CAP = 64 * 1024
const RECOVERY_LIMIT = 20

export interface CompletionSentinelSink {
  stage(input: SentinelReportInput): SentinelSignal | null
  publishStaged(projectId: string, id: string, triage: SentinelTriage): SentinelSignal | null
  pendingStaged(source: SentinelSignal['source'], limit?: number): SentinelSignal[]
}

export interface CompletionSummarizer {
  summarize(evidence: CompletionEvidence): Promise<SentinelTriage | null>
}

/**
 * Successful Swarm completion coordinator:
 * terminal tail → bounded deterministic evidence → silent durable Sentinel row
 * → optional tool-less interpretation → one app/macOS publication. The model
 * is never load-bearing: invalid, slow or unavailable analysis gets a deterministic
 * manager-shaped fallback over the same evidence.
 */
export class SwarmCompletionSteward {
  private readonly tails = new Map<string, string>()

  constructor(
    events: CockpitEvents,
    private readonly sentinel: CompletionSentinelSink,
    private readonly summarizer: CompletionSummarizer,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    events.onTyped('terminal:data', ({ sessionId, data }) => this.onData(sessionId, data))
  }

  /** Begin capturing a bounded tail for exactly this Swarm session. */
  track(sessionId: string): void {
    if (!this.tails.has(sessionId)) this.tails.set(sessionId, '')
  }

  /** Free a failed/parked/retired session without interpreting it as success. */
  discard(sessionId: string): void {
    this.tails.delete(sessionId)
  }

  async complete(input: {
    projectId: string
    sessionId: string | null
    report: CompletionReport
  }): Promise<void> {
    try {
      const output = input.sessionId ? this.take(input.sessionId) : ''
      const evidence = buildCompletionEvidence(input.report, output)
      const staged = this.sentinel.stage({
        projectId: input.projectId,
        severity: 'notice',
        source: 'swarm-completion',
        title: `Ready for review · ${input.report.title}`,
        summary: formatCompletionSummary(input.report),
        context: evidence.context,
        // Same transition replay dedups; a later rerun has a new finishedAt and
        // therefore deserves a fresh signal even when it is the same card.
        dedupKey: `card:${input.report.cardId}:${input.report.finishedAt}`,
      })
      if (!staged) return
      await this.summarizeAndPublish(staged, evidence)
    } catch {
      // Board state and the immediate completion activity event are already
      // durable/visible. Stewardship is an epilogue and must never reject out.
    }
  }

  /** Resume rows persisted before a crash, one-by-one to avoid a Pro fan-out. */
  async resumePending(): Promise<void> {
    try {
      const pending = this.sentinel.pendingStaged('swarm-completion', RECOVERY_LIMIT)
      for (const signal of pending) {
        const evidence = parseCompletionEvidence(signal.context)
        if (!evidence) continue
        await this.summarizeAndPublish(signal, evidence)
      }
    } catch {
      // Recovery is best-effort; the persisted feed row still survives.
    }
  }

  clear(): void {
    this.tails.clear()
  }

  private async summarizeAndPublish(
    signal: SentinelSignal,
    evidence: CompletionEvidence,
  ): Promise<void> {
    let triage: SentinelTriage | null = null
    try {
      triage = await this.summarizer.summarize(evidence)
    } catch {
      triage = null
    }
    const publishable = triage ?? deterministicCompletionTriage(evidence, this.now())
    this.sentinel.publishStaged(signal.projectId, signal.id, publishable)
  }

  private onData(sessionId: string, data: string): void {
    const current = this.tails.get(sessionId)
    if (current === undefined) return
    const next = current + data
    this.tails.set(
      sessionId,
      next.length > OUTPUT_TAIL_CAP ? next.slice(next.length - OUTPUT_TAIL_CAP) : next,
    )
  }

  private take(sessionId: string): string {
    const output = this.tails.get(sessionId) ?? ''
    this.tails.delete(sessionId)
    return output
  }
}
