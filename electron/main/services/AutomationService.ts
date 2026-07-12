import {
  AUTOMATION_POLICY,
  nextAutomationRun,
  type AutomationCreateInput,
  type AutomationInterpretation,
  type AutomationJob,
} from '@shared/automation'
import type { OperationalHealthSnapshot } from '@shared/operational-health'
import type { ApprovalService } from './ApprovalService'
import type {
  AutomationRepository,
} from './AutomationStateStore'
import type { OperationalHealthService } from './OperationalHealthService'
import type { SentinelReportInput, SentinelService } from './SentinelService'
import type { HermesAutomationRunner } from './hermes/HermesAutomationRunner'

interface AutomationScheduleDriver {
  setInterval(handler: () => void, delayMs: number): unknown
  clearInterval(handle: unknown): void
}

const DEFAULT_SCHEDULE: AutomationScheduleDriver = {
  setInterval: (handler, delayMs) => setInterval(handler, delayMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}

interface AutomationDependencies {
  store: AutomationRepository
  projects: { list(): readonly { id: string; path: string }[] }
  health: Pick<OperationalHealthService, 'inspect'>
  runner: Pick<HermesAutomationRunner, 'interpret'> & Partial<Pick<HermesAutomationRunner, 'killAll'>>
  sentinel: Pick<SentinelService, 'stage' | 'publishStaged'>
  approvals: Pick<ApprovalService, 'request'>
  now?: () => number
  schedule?: AutomationScheduleDriver
  changed?: (projectId: string) => void
}

/**
 * App-owned safe scheduler. Time, persistence, overlap claims, and approval
 * routing are deterministic; Hermes receives only a content-free health
 * snapshot through a harmless tool allowlist and can never execute its advice.
 */
export class AutomationService {
  private readonly running = new Set<string>()
  private tickInFlight = false
  private timer: unknown = null
  private readonly now: () => number
  private readonly schedule: AutomationScheduleDriver

  constructor(private readonly deps: AutomationDependencies) {
    this.now = deps.now ?? (() => Date.now())
    this.schedule = deps.schedule ?? DEFAULT_SCHEDULE
  }

  start(): void {
    if (this.timer !== null) return
    const at = this.nowIso()
    for (const project of this.deps.projects.list()) {
      try {
        this.deps.store.ensureDailyDigest(project.id, at)
      } catch {
        // A temporary persistence miss must never prevent the app from booting.
      }
    }
    this.timer = this.schedule.setInterval(
      () => void this.tick(),
      AUTOMATION_POLICY.tickMs,
    )
    ;(this.timer as { unref?: () => void } | null)?.unref?.()
  }

  stop(): void {
    if (this.timer !== null) {
      this.schedule.clearInterval(this.timer)
      this.timer = null
    }
    try {
      this.deps.runner.killAll?.()
    } catch {
      // Shutdown remains best-effort.
    }
  }

  list(projectId: string): AutomationJob[] {
    this.deps.store.ensureDailyDigest(projectId, this.nowIso())
    return this.deps.store.list(projectId)
  }

  create(input: AutomationCreateInput): AutomationJob {
    const created = this.deps.store.create(input, this.nowIso())
    this.notifyChanged(input.projectId)
    return created
  }

  setEnabled(projectId: string, id: string, enabled: boolean): AutomationJob | null {
    const job = this.deps.store.setEnabled(projectId, id, enabled, this.nowIso())
    if (job) this.notifyChanged(projectId)
    return job
  }

  remove(projectId: string, id: string): boolean {
    const removed = this.deps.store.remove(projectId, id)
    if (removed) this.notifyChanged(projectId)
    return removed
  }

  async runNow(projectId: string, id: string): Promise<AutomationJob | null> {
    return this.execute(projectId, id, true)
  }

  async tick(): Promise<void> {
    if (this.tickInFlight) return
    this.tickInFlight = true
    try {
      const at = this.nowIso()
      for (const job of this.deps.store.due(at, 20)) {
        await this.execute(job.projectId, job.id, false)
      }
    } catch {
      // The next timer tick is the retry path; never leak an async rejection.
    } finally {
      this.tickInFlight = false
    }
  }

  private async execute(
    projectId: string,
    id: string,
    force: boolean,
  ): Promise<AutomationJob | null> {
    if (this.running.has(id)) return null
    const at = this.nowIso()
    const claimed = this.deps.store.claim(projectId, id, at, force)
    if (!claimed) return null
    this.running.add(id)
    const nextRunAt = nextAutomationRun(claimed.schedule, at)
    try {
      const project = this.deps.projects.list().find((item) => item.id === projectId)
      if (!project) throw new Error('project unavailable')
      const snapshot = await this.deps.health.inspect(projectId)
      if (!snapshot) throw new Error('health snapshot unavailable')
      const interpretation = await this.deps.runner.interpret(project.path, claimed, snapshot)
      const result = this.resultText(interpretation)

      // Result first. Notifications and approval requests are downstream
      // effects and can never become the only surviving record of a run.
      const completed = this.deps.store.complete(projectId, id, { at, nextRunAt, result })
      this.notifyChanged(projectId)

      // The specialist result is already the one allowed Flash interpretation.
      // Stage + publish it directly so Sentinel does not spend a second generic
      // triage call. Delivery failure cannot rewrite a successful run as failed.
      if (claimed.kind === 'digest' || interpretation.reportWorthy) {
        try {
          const staged = this.deps.sentinel.stage(
            this.reportInput(claimed, interpretation, snapshot),
          )
          if (staged) {
            this.deps.sentinel.publishStaged(projectId, staged.id, {
              reportWorthy: true,
              headline: interpretation.headline,
              action: interpretation.action,
              gotchaCandidate: false,
              at,
            })
          }
        } catch {
          // The durable card result remains the source of truth.
        }
      }
      if (interpretation.proposal) {
        try {
          this.deps.approvals.request({
            projectId,
            actionType: 'propose_open_swarm_card',
            summary: interpretation.proposal.reason,
            payload: {
              title: interpretation.proposal.title,
              body: interpretation.proposal.body,
            },
          })
        } catch {
          // A proposal is advisory and never makes the completed observation fail.
        }
      }
      return completed
    } catch (err) {
      const failed = this.deps.store.fail(projectId, id, {
        at,
        nextRunAt,
        error: this.failureMessage(err),
      })
      this.notifyChanged(projectId)
      return failed
    } finally {
      this.running.delete(id)
    }
  }

  private reportInput(
    job: AutomationJob,
    result: AutomationInterpretation,
    snapshot: OperationalHealthSnapshot,
  ): SentinelReportInput {
    return {
      projectId: job.projectId,
      source: 'automation',
      severity: 'notice',
      title: result.headline,
      summary: result.summary,
      context: JSON.stringify({
        automationId: job.id,
        kind: job.kind,
        action: result.action,
        healthFingerprint: snapshot.fingerprint,
        proposalPending: Boolean(result.proposal),
      }),
      dedupKey: `automation:${job.id}:${snapshot.fingerprint}:${result.headline}`,
    }
  }

  private resultText(result: AutomationInterpretation): string {
    const text = `${result.headline}\n${result.summary}\nNext: ${result.action}`
    return text.slice(0, AUTOMATION_POLICY.maxResultChars)
  }

  private failureMessage(err: unknown): string {
    const message = err instanceof Error ? err.message.toLowerCase() : ''
    if (message.includes('timeout') || message.includes('timed out')) return 'Hermes timed out.'
    if (message.includes('health snapshot')) return 'Project health was temporarily unavailable.'
    if (message.includes('project unavailable')) return 'The project is no longer available.'
    return 'Automation could not complete. Try again.'
  }

  private notifyChanged(projectId: string): void {
    try {
      this.deps.changed?.(projectId)
    } catch {
      // UI refresh is never load-bearing.
    }
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString()
  }
}
