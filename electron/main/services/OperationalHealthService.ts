import { projectBrain } from '@shared/memory-ledger'
import {
  OPERATIONAL_HEALTH_POLICY,
  evaluateOperationalHealth,
  type OperationalHealthSensor,
  type OperationalHealthSnapshot,
} from '@shared/operational-health'
import type { AgentUsageService } from './AgentUsageService'
import type { ApprovalService } from './ApprovalService'
import type { AuditLogService } from './AuditLogService'
import type { GitService } from './GitService'
import type { LogIntelligenceService } from './LogIntelligenceService'
import type { MemoryCaptureQueue } from './MemoryCaptureQueue'
import type { MemoryReviewService } from './MemoryReviewService'
import type {
  OperationalHealthState,
  OperationalHealthStateRepository,
} from './OperationalHealthStateStore'
import type { SentinelReportInput, SentinelService } from './SentinelService'
import type { SwarmService } from './SwarmService'
import type { TerminalManager } from './TerminalManager'

interface OperationalHealthSchedule {
  setInterval(handler: () => void, delayMs: number): unknown
  clearInterval(handle: unknown): void
}

const DEFAULT_SCHEDULE: OperationalHealthSchedule = {
  setInterval: (handler, delayMs) => setInterval(handler, delayMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}

interface OperationalHealthDependencies {
  state: OperationalHealthStateRepository
  sentinel: Pick<SentinelService, 'report'>
  projects: { list(): readonly { id: string }[] }
  git: Pick<GitService, 'status'>
  usage: Pick<AgentUsageService, 'getReport'>
  swarm: Pick<SwarmService, 'board'>
  terminals: Pick<TerminalManager, 'list'>
  logs: Pick<LogIntelligenceService, 'listInsights'>
  approvals: Pick<ApprovalService, 'list'>
  captures: Pick<MemoryCaptureQueue, 'list'>
  reviews: Pick<MemoryReviewService, 'listPending'>
  audit: Pick<AuditLogService, 'recent'>
  now?: () => number
  schedule?: OperationalHealthSchedule
}

/**
 * Scheduled cross-system steward. Deterministic sensors always run first and a
 * bounded result is persisted before Sentinel is asked to deliver/triage it.
 * Healthy, unchanged runs perform no model call and no notification.
 */
export class OperationalHealthService {
  private readonly runningProjects = new Set<string>()
  private sweepInFlight = false
  private timer: unknown = null
  private readonly now: () => number
  private readonly schedule: OperationalHealthSchedule

  constructor(private readonly deps: OperationalHealthDependencies) {
    this.now = deps.now ?? (() => Date.now())
    this.schedule = deps.schedule ?? DEFAULT_SCHEDULE
  }

  start(): void {
    if (this.timer !== null) return
    const at = new Date(this.now()).toISOString()
    try {
      this.deps.state.recoverStale(at)
    } catch {
      // A stale lock can also expire naturally at claim time; boot stays safe.
    }
    void this.runAll()
    this.timer = this.schedule.setInterval(
      () => void this.runAll(),
      OPERATIONAL_HEALTH_POLICY.sweepIntervalMs,
    )
    const handle = this.timer as { unref?: () => void } | null
    handle?.unref?.()
  }

  stop(): void {
    if (this.timer === null) return
    this.schedule.clearInterval(this.timer)
    this.timer = null
  }

  /** Run projects sequentially; quota probes and model handoffs never fan out. */
  async runAll(): Promise<void> {
    if (this.sweepInFlight) return
    this.sweepInFlight = true
    try {
      for (const project of this.deps.projects.list()) {
        try {
          await this.runProject(project.id)
        } catch {
          // One project never blocks the remaining scheduled sweep.
        }
      }
    } finally {
      this.sweepInFlight = false
    }
  }

  /** Returns null when an overlapping run owns the project claim. */
  async runProject(projectId: string): Promise<OperationalHealthSnapshot | null> {
    if (this.runningProjects.has(projectId)) return null
    this.runningProjects.add(projectId)
    const at = new Date(this.now()).toISOString()
    let claimed: OperationalHealthState | null = null
    try {
      claimed = this.deps.state.claim(projectId, at)
      if (!claimed) return null
      const snapshot = await this.snapshot(projectId, at)
      const decision = this.deliveryDecision(claimed, snapshot)

      // Persist the bounded facts + change/digest decision BEFORE report(),
      // whose optional Flash triage begins asynchronously after its own signal
      // row is persisted. A healthy unchanged run stops here.
      this.deps.state.complete({
        projectId,
        snapshot,
        at,
        notifiedFingerprint: decision.kind
          ? `${decision.kind}:${snapshot.fingerprint}`
          : null,
        notifiedAt: decision.kind ? at : null,
        // Kept null for V20 row compatibility. The visible automation schedule
        // now owns daily briefing cadence and its pause/resume state.
        digestAt: null,
      })

      if (decision.kind) {
        try {
          this.deps.sentinel.report(this.reportInput(snapshot))
        } catch {
          // Sentinel's public contract already swallows, but structural fakes
          // and future implementations cannot endanger the completed snapshot.
        }
      }
      return snapshot
    } catch {
      if (claimed) {
        try {
          this.deps.state.abandon(projectId, at)
        } catch {
          // Claim expiry is the final recovery path.
        }
      }
      return null
    } finally {
      this.runningProjects.delete(projectId)
    }
  }

  /** Fresh content-free evidence for a user-scheduled automation. This does not
   * mutate the health cadence/fingerprint or emit a second Sentinel signal. */
  async inspect(projectId: string): Promise<OperationalHealthSnapshot | null> {
    try {
      return await this.snapshot(projectId, new Date(this.now()).toISOString())
    } catch {
      return null
    }
  }

  private async snapshot(projectId: string, checkedAt: string): Promise<OperationalHealthSnapshot> {
    const unavailable = new Set<OperationalHealthSensor>()
    const since = new Date(
      Date.parse(checkedAt) - OPERATIONAL_HEALTH_POLICY.lookbackMs,
    ).toISOString()

    const [rawGit, quota, swarm, processes, logs, approvals, memory] = await Promise.all([
      this.probe('git', unavailable, () => this.deps.git.status(projectId)),
      this.probe('quota', unavailable, () => this.deps.usage.getReport()),
      this.probe('swarm', unavailable, () => ({
        cards: this.deps.swarm.board(projectId).flatMap((column) => column.cards),
        terminals: this.deps.terminals.list(projectId),
      })),
      this.probe('processes', unavailable, () => ({
        reapedRecent: this.deps.audit.recent(projectId, 'system.zombie_reaped', since, 100).length,
        unverifiedRecent: this.deps.audit.recent(
          projectId,
          'system.zombie_unverified',
          since,
          100,
        ).length,
      })),
      this.probe('logs', unavailable, () => this.deps.logs.listInsights(projectId, 100)),
      this.probe('approvals', unavailable, () => this.deps.approvals.list(projectId, 100)),
      this.probe('memory', unavailable, () => ({
        captureJobs: this.deps.captures.list(projectId),
        reviews: this.deps.reviews.listPending(projectBrain(projectId)),
      })),
    ])

    const git = rawGit && rawGit.branch !== 'no-git'
      ? {
          ahead: rawGit.ahead,
          behind: rawGit.behind,
          changedFiles: rawGit.changedFilesCount,
          conflicts: rawGit.files.filter((file) => file.state === 'conflicted').length,
          detached: rawGit.branch === 'detached',
        }
      : null

    return evaluateOperationalHealth({
      projectId,
      checkedAt,
      git,
      quota,
      swarm,
      processes,
      logs,
      approvals,
      memory,
      unavailableSensors: [...unavailable],
    })
  }

  private async probe<T>(
    sensor: OperationalHealthSensor,
    unavailable: Set<OperationalHealthSensor>,
    read: () => T | Promise<T>,
  ): Promise<T | null> {
    try {
      return await read()
    } catch {
      unavailable.add(sensor)
      return null
    }
  }

  private deliveryDecision(
    previous: OperationalHealthState,
    snapshot: OperationalHealthSnapshot,
  ): { kind: 'anomaly' | null } {
    const onlySensorBlindSpots =
      snapshot.anomalies.length > 0 &&
      snapshot.anomalies.every((item) => item.code.startsWith('sensor-unavailable:'))
    const previousUnavailable = Array.isArray(previous.lastResult?.unavailableSensors)
      ? previous.lastResult.unavailableSensors
      : []
    const repeatedBlindSpot =
      onlySensorBlindSpots &&
      snapshot.unavailableSensors.some((sensor) => previousUnavailable.includes(sensor)) &&
      previous.lastNotifiedFingerprint !== `anomaly:${snapshot.fingerprint}`
    const hasChangedAnomaly =
      snapshot.anomalies.length > 0 &&
      snapshot.fingerprint !== previous.lastFingerprint &&
      !onlySensorBlindSpots
    // Daily briefings are owned by the visible, pausable automation schedule.
    // This lower-level sweep reports only genuine health-state changes, so the
    // owner can never receive two separate daily digests for the same evidence.
    if (hasChangedAnomaly || repeatedBlindSpot) {
      return { kind: 'anomaly' }
    }
    return { kind: null }
  }

  private reportInput(snapshot: OperationalHealthSnapshot): SentinelReportInput {
    const alert = snapshot.anomalies.some((item) => item.severity === 'alert')
    const issueSummary = snapshot.anomalies
      .slice(0, 3)
      .map((item) => item.summary)
      .join(' ')
    const summary = `${snapshot.anomalies.length} actionable health change(s) detected. ${issueSummary}`
    return {
      projectId: snapshot.projectId,
      source: 'operational-health',
      severity: alert ? 'alert' : 'notice',
      title: 'Operational health needs attention',
      summary,
      context: this.compactContext(snapshot),
      dedupKey: `operational-health:${snapshot.fingerprint}`,
    }
  }

  private compactContext(snapshot: OperationalHealthSnapshot): string {
    return JSON.stringify({
      checkedAt: snapshot.checkedAt,
      git: snapshot.git,
      quota: snapshot.quota,
      swarm: snapshot.swarm,
      processes: snapshot.processes,
      logs: snapshot.logs,
      approvals: snapshot.approvals,
      memory: snapshot.memory,
      unavailableSensors: snapshot.unavailableSensors,
      anomalies: snapshot.anomalies.map(({ code, severity, count }) => ({ code, severity, count })),
    })
  }
}
