import type {
  AgentUsageReport,
  ApprovalRequest,
  ErrorInsight,
  TerminalSession,
} from './domain'
import type { KanbanCard } from './kanban'
import type { CaptureJob } from './memory-capture'
import type { ReviewItem } from './memory-review'

/**
 * Cheap operational-health policy. Every threshold is deliberately slow enough
 * to ignore normal development churn; event-specific sensors still handle fast
 * failures. This sweep is the calm cross-system read model, not another log
 * stream.
 */
export const OPERATIONAL_HEALTH_POLICY = {
  sweepIntervalMs: 30 * 60_000,
  /** Lookback for slow health sensors. Any digest delivery is owned by an explicit scheduler. */
  lookbackMs: 24 * 60 * 60_000,
  staleRunMs: 10 * 60_000,
  stuckWorkerMs: 20 * 60_000,
  parkedCardMs: 24 * 60 * 60_000,
  staleApprovalMs: 60 * 60_000,
  recentLogMs: 60 * 60_000,
  stuckCaptureMs: 20 * 60_000,
  oldReviewMs: 7 * 24 * 60 * 60_000,
  lowQuotaUsedPercent: 90,
  recurringLogOccurrences: 3,
  liveReviewTerminalPressure: 3,
} as const

export type OperationalHealthSensor =
  | 'git'
  | 'quota'
  | 'swarm'
  | 'processes'
  | 'logs'
  | 'approvals'
  | 'memory'

export interface OperationalHealthInput {
  projectId: string
  checkedAt: string
  git: {
    ahead: number
    behind: number
    changedFiles: number
    conflicts: number
    detached: boolean
  } | null
  quota: AgentUsageReport | null
  swarm: {
    cards: readonly KanbanCard[]
    terminals: readonly TerminalSession[]
  } | null
  processes: {
    reapedRecent: number
    unverifiedRecent: number
  } | null
  logs: readonly ErrorInsight[] | null
  approvals: readonly ApprovalRequest[] | null
  memory: {
    captureJobs: readonly CaptureJob[]
    reviews: readonly ReviewItem[]
  } | null
  unavailableSensors: readonly OperationalHealthSensor[]
}

export interface OperationalHealthAnomaly {
  /** Stable machine identity. Dynamic values are limited to closed provider/sensor names. */
  code: string
  severity: 'notice' | 'alert'
  count: number
  summary: string
  action: string
}

/**
 * Persisted and model-visible health result. It intentionally contains only
 * counts, closed categories, booleans, and timestamps — no paths, card titles,
 * log patterns, approval payloads, transcript errors, or Memory note content.
 */
export interface OperationalHealthSnapshot {
  schema: 1
  projectId: string
  checkedAt: string
  git: {
    available: boolean
    ahead: number
    behind: number
    changedFiles: number
    conflicts: number
    detached: boolean
  }
  quota: {
    availableProviders: number
    unavailableProviders: string[]
    lowProviders: string[]
    exhaustedProviders: string[]
  }
  swarm: {
    inProgress: number
    missingWorkers: number
    stuckWorkers: number
    parked: number
    staleParked: number
    inReview: number
    liveReviewTerminals: number
  }
  processes: {
    reapedRecent: number
    unverifiedRecent: number
  }
  logs: {
    recentHigh: number
    recentCritical: number
    recurringHigh: number
  }
  approvals: {
    pending: number
    stale: number
  }
  memory: {
    queued: number
    processing: number
    stuckProcessing: number
    errors: number
    pendingReviews: number
    conflicts: number
    oldReviews: number
  }
  unavailableSensors: OperationalHealthSensor[]
  anomalies: OperationalHealthAnomaly[]
  /** Stable across count-only churn; changes when an actionable class appears/disappears/escalates. */
  fingerprint: string
}

const ageAtLeast = (at: string, now: number, threshold: number): boolean => {
  const parsed = Date.parse(at)
  return !Number.isNaN(parsed) && now - parsed >= threshold
}

const recent = (at: string, now: number, windowMs: number): boolean => {
  const parsed = Date.parse(at)
  return !Number.isNaN(parsed) && now >= parsed && now - parsed <= windowMs
}

const nonNegative = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0

/**
 * Evaluate a raw in-process sensor bundle into the content-free durable result.
 * Raw objects are accepted only so the boundary can derive relationships (for
 * example card terminal id -> live terminal); none of their free text survives.
 */
export function evaluateOperationalHealth(
  input: OperationalHealthInput,
): OperationalHealthSnapshot {
  const parsedNow = Date.parse(input.checkedAt)
  const now = Number.isNaN(parsedNow) ? 0 : parsedNow
  const anomalies: OperationalHealthAnomaly[] = []
  const add = (
    code: string,
    severity: OperationalHealthAnomaly['severity'],
    count: number,
    summary: string,
    action: string,
  ) => {
    if (count <= 0) return
    anomalies.push({ code, severity, count: nonNegative(count), summary, action })
  }

  const git = {
    available: input.git !== null,
    ahead: nonNegative(input.git?.ahead ?? 0),
    behind: nonNegative(input.git?.behind ?? 0),
    changedFiles: nonNegative(input.git?.changedFiles ?? 0),
    conflicts: nonNegative(input.git?.conflicts ?? 0),
    detached: input.git?.detached ?? false,
  }
  add(
    'git-conflicts',
    'alert',
    git.conflicts,
    'Git has unresolved merge conflicts.',
    'Review and resolve the conflicted files before starting more work.',
  )
  add(
    'git-diverged',
    'notice',
    git.ahead > 0 && git.behind > 0 ? 1 : 0,
    'The local branch has diverged from its remote.',
    'Review both sides before the next pull or push.',
  )

  const availableProviders: string[] = []
  const unavailableProviders: string[] = []
  const lowProviders: string[] = []
  const exhaustedProviders: string[] = []
  for (const provider of input.quota?.providers ?? []) {
    if (!provider.available) {
      unavailableProviders.push(provider.provider)
      continue
    }
    availableProviders.push(provider.provider)
    const maxUsed = provider.windows.reduce(
      (max, window) => Math.max(max, nonNegative(window.usedPercent)),
      0,
    )
    if (maxUsed >= 100) {
      exhaustedProviders.push(provider.provider)
      add(
        `quota-exhausted:${provider.provider}`,
        'alert',
        1,
        `${provider.label} quota is exhausted.`,
        'Pause new dispatches or use an explicitly approved fallback.',
      )
    } else if (maxUsed >= OPERATIONAL_HEALTH_POLICY.lowQuotaUsedPercent) {
      lowProviders.push(provider.provider)
      add(
        `quota-low:${provider.provider}`,
        'notice',
        1,
        `${provider.label} quota is nearly exhausted.`,
        'Finish active work before opening another expensive task.',
      )
    }
  }
  availableProviders.sort()
  unavailableProviders.sort()
  lowProviders.sort()
  exhaustedProviders.sort()
  const quota = {
    availableProviders: availableProviders.length,
    unavailableProviders,
    lowProviders,
    exhaustedProviders,
  }

  const cards = input.swarm?.cards ?? []
  const terminals = input.swarm?.terminals ?? []
  const liveById = new Map(terminals.map((session) => [session.id, session]))
  const inProgressCards = cards.filter((item) => item.status === 'in_progress')
  const parkedCards = cards.filter((item) => item.status === 'parked')
  const reviewCards = cards.filter((item) => item.status === 'in_review')
  const missingWorkers = inProgressCards.filter(
    (item) => !item.terminalSessionId || !liveById.has(item.terminalSessionId),
  ).length
  const stuckWorkers = inProgressCards.filter((item) => {
    if (!item.terminalSessionId) return false
    const session = liveById.get(item.terminalSessionId)
    return session
      ? ageAtLeast(session.lastActiveAt, now, OPERATIONAL_HEALTH_POLICY.stuckWorkerMs)
      : false
  }).length
  const staleParked = parkedCards.filter((item) =>
    ageAtLeast(item.updatedAt, now, OPERATIONAL_HEALTH_POLICY.parkedCardMs),
  ).length
  const liveReviewTerminals = new Set(
    reviewCards
      .map((item) => item.terminalSessionId)
      .filter((id): id is string => Boolean(id && liveById.has(id))),
  ).size
  const swarm = {
    inProgress: inProgressCards.length,
    missingWorkers,
    stuckWorkers,
    parked: parkedCards.length,
    staleParked,
    inReview: reviewCards.length,
    liveReviewTerminals,
  }
  add(
    'swarm-worker-missing',
    'alert',
    missingWorkers,
    'A running Swarm card has no live worker.',
    'Inspect the card and either resume it or park it safely.',
  )
  add(
    'swarm-worker-stuck',
    'notice',
    stuckWorkers,
    'A Swarm worker has stopped producing output.',
    'Inspect its terminal before deciding whether to wait, resume, or park.',
  )
  add(
    'swarm-parked-stale',
    'notice',
    staleParked,
    'Parked Swarm work has been waiting for more than a day.',
    'Review whether the parked work should resume or be closed.',
  )
  add(
    'swarm-review-terminal-pressure',
    'notice',
    liveReviewTerminals >= OPERATIONAL_HEALTH_POLICY.liveReviewTerminalPressure
      ? liveReviewTerminals
      : 0,
    'Completed review cards are still holding several live terminals.',
    'Close reviewed worker terminals to free capacity.',
  )

  const processes = {
    reapedRecent: nonNegative(input.processes?.reapedRecent ?? 0),
    unverifiedRecent: nonNegative(input.processes?.unverifiedRecent ?? 0),
  }
  add(
    'orphan-unverified',
    'notice',
    processes.unverifiedRecent,
    'A possible orphan process could not be safely verified.',
    'Inspect the process manually; automatic cleanup intentionally declined to kill it.',
  )

  const recentInsights = (input.logs ?? []).filter((item) =>
    recent(item.lastSeenAt, now, OPERATIONAL_HEALTH_POLICY.recentLogMs),
  )
  const recentCritical = recentInsights.filter((item) => item.severity === 'critical').length
  const recentHigh = recentInsights.filter((item) => item.severity === 'high').length
  const recurringHigh = recentInsights.filter(
    (item) =>
      item.severity === 'high' &&
      item.occurrences >= OPERATIONAL_HEALTH_POLICY.recurringLogOccurrences,
  ).length
  const logs = { recentHigh, recentCritical, recurringHigh }
  // LogIntelligence already raises event-time Sentinel signals. The sweep keeps
  // aggregate counts for the daily manager digest but never duplicates those
  // immediate notifications with a second operational-health toast.

  const pendingApprovals = (input.approvals ?? []).filter((item) => item.status === 'pending')
  const staleApprovals = pendingApprovals.filter((item) =>
    ageAtLeast(item.createdAt, now, OPERATIONAL_HEALTH_POLICY.staleApprovalMs),
  ).length
  const approvals = { pending: pendingApprovals.length, stale: staleApprovals }
  add(
    'approval-stale',
    'notice',
    staleApprovals,
    'An approval has been waiting for more than an hour.',
    'Approve or reject the request from the Dashboard.',
  )

  const captureJobs = input.memory?.captureJobs ?? []
  const reviews = input.memory?.reviews ?? []
  const processing = captureJobs.filter((item) =>
    ['reading', 'distilling', 'reconciling', 'committing'].includes(item.status),
  )
  const captureErrors = captureJobs.filter((item) => item.status === 'error').length
  const stuckProcessing = processing.filter((item) =>
    ageAtLeast(item.updatedAt, now, OPERATIONAL_HEALTH_POLICY.stuckCaptureMs),
  ).length
  const memory = {
    queued: captureJobs.filter((item) => item.status === 'queued').length,
    processing: processing.length,
    stuckProcessing,
    errors: captureErrors,
    pendingReviews: reviews.length,
    conflicts: reviews.filter((item) => item.kind === 'conflict').length,
    oldReviews: reviews.filter((item) =>
      ageAtLeast(item.createdAt, now, OPERATIONAL_HEALTH_POLICY.oldReviewMs),
    ).length,
  }
  // Exhausted capture/review pressure is owned by MemoryLifecycleSentinel.
  // Retain the counts here for cross-system context; only a genuinely stuck
  // processing row (which that event sensor cannot observe) is raised here.
  add(
    'memory-capture-stuck',
    'notice',
    stuckProcessing,
    'A Memory capture job appears stuck.',
    'Restart capture processing and verify that the queue advances.',
  )

  const unavailableSensors = [...new Set(input.unavailableSensors)].sort()
  for (const sensor of unavailableSensors) {
    add(
      `sensor-unavailable:${sensor}`,
      'notice',
      1,
      `The ${sensor} health sensor could not be read.`,
      'Retry the health check and inspect the subsystem if it remains unavailable.',
    )
  }

  anomalies.sort((a, b) => a.code.localeCompare(b.code))
  const fingerprint = anomalies.length
    ? anomalies.map((item) => `${item.severity}:${item.code}`).join('|')
    : 'healthy'

  return {
    schema: 1,
    projectId: input.projectId,
    checkedAt: input.checkedAt,
    git,
    quota,
    swarm,
    processes,
    logs,
    approvals,
    memory,
    unavailableSensors,
    anomalies,
    fingerprint,
  }
}
