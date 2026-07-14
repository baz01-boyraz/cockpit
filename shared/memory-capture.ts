/**
 * Capture-queue domain types (docs/memory-imp.md G2). Pure shapes shared by the
 * queue service, the IPC contract, and the mock. The queue is the durability
 * boundary: a session enqueued here survives quit/crash and is never dropped.
 */

export const CAPTURE_PROCESSING_STAGES = [
  'reading',
  'distilling',
  'reconciling',
  'committing',
] as const
export type CaptureProcessingStage = (typeof CAPTURE_PROCESSING_STAGES)[number]

export const CAPTURE_STATUSES = [
  'queued',
  ...CAPTURE_PROCESSING_STAGES,
  'retry_wait',
  'blocked',
  'done',
  'error',
] as const
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number]

export interface CaptureJob {
  id: string
  projectId: string
  provider: 'claude' | 'codex'
  sessionId: string
  sourcePath: string
  status: CaptureStatus
  /** Byte cursor — only turns past this offset are distilled next time. */
  lastOffset: number
  attempts: number
  error: string | null
  /** Scheduled retry after a transient failure; null for every other state. */
  nextRetryAt: string | null
  /** Human-readable recovery step for blocked/exhausted jobs. */
  guidance: string | null
  enqueuedAt: string
  updatedAt: string
}

/** Give up auto-retrying a session after this many failed attempts. */
export const CAPTURE_MAX_ATTEMPTS = 3
/** Sessions older than this are historical context, not automatic capture work. */
export const MEMORY_CAPTURE_RECENT_MS = 3 * 24 * 60 * 60 * 1_000

export type CaptureFailureDisposition = 'blocked' | 'retry'
export type CaptureFailureScope = 'provider' | 'session'

export function classifyCaptureFailure(message: string): {
  disposition: CaptureFailureDisposition
  scope: CaptureFailureScope
  guidance: string
} {
  if (/openrouter[^\n]*(?:key|secret)|api\s*key|credential|configure[^\n]*settings/i.test(message)) {
    return {
      disposition: 'blocked',
      scope: 'provider',
      guidance: 'Add or verify the OpenRouter key in Settings, then press Retry.',
    }
  }
  if (/enoent|missing[^\n]*transcript|no\s+such\s+file|transcript[^\n]*(?:absent|not\s+found)/i.test(message)) {
    return {
      disposition: 'blocked',
      scope: 'session',
      guidance: 'The provider transcript is unavailable. Restore it or capture a newer session, then press Retry.',
    }
  }
  return {
    disposition: 'retry',
    scope: 'session',
    guidance: 'Cockpit will retry automatically. If it keeps failing, check provider connectivity and press Retry.',
  }
}

export interface MemoryCaptureJobSummary {
  id: string
  provider: 'claude' | 'codex'
  status: CaptureStatus
  attempts: number
  nextRetryAt: string | null
  guidance: string | null
  updatedAt: string
}

export interface MemoryCaptureProviderCoverage {
  provider: 'claude' | 'codex'
  sessions: number
  captured: number
  pending: number
  blocked: number
  lastCapturedAt: string | null
}

export interface MemoryCaptureOverview {
  providers: MemoryCaptureProviderCoverage[]
  jobs: MemoryCaptureJobSummary[]
}

export const MEMORY_CAPTURE_NOTICE_OUTCOMES = ['created', 'updated', 'review'] as const
export type MemoryCaptureNoticeOutcome = (typeof MEMORY_CAPTURE_NOTICE_OUTCOMES)[number]

/**
 * Safe, bounded result pushed to the renderer after an automatic capture.
 * Raw transcript paths, prompts, note bytes, and model errors never cross IPC.
 */
export interface MemoryCaptureNotice {
  id: string
  projectId: string
  provider: 'claude' | 'codex'
  /** Provider-native transcript id — provenance, not a Cockpit project id. */
  sourceSessionId: string
  outcome: MemoryCaptureNoticeOutcome
  scope: 'project' | 'global'
  slug: string
  title: string
  /** One redacted, bounded fact summary suitable for a transient toast. */
  summary: string
  /** Why the distiller considered the fact durable, also bounded. */
  reason: string
  at: string
}

/**
 * Migration-era terminal errors had no recovery guidance. Once the same
 * project/provider later completes a capture, those rows are historical
 * evidence rather than a live outage. Keep unrecovered legacy rows and every
 * modern guided failure actionable.
 */
export function actionableCaptureFailures(
  jobs: readonly CaptureJob[],
): CaptureJob[] {
  const latestSuccess = new Map<string, string>()
  for (const job of jobs) {
    if (job.status !== 'done') continue
    const key = `${job.projectId}\u0000${job.provider}`
    const current = latestSuccess.get(key)
    if (!current || job.updatedAt > current) latestSuccess.set(key, job.updatedAt)
  }
  return jobs.filter((job) => {
    if (job.status !== 'error') return false
    if (job.guidance !== null) return true
    const recoveredAt = latestSuccess.get(`${job.projectId}\u0000${job.provider}`)
    return recoveredAt === undefined || job.updatedAt >= recoveredAt
  })
}

export function assembleMemoryCaptureOverview(
  sessions: readonly {
    id: string
    provider: 'claude' | 'codex'
    lastActiveAt?: string
    sizeBytes?: number
  }[],
  jobs: readonly CaptureJob[],
  nowMs = Date.now(),
): MemoryCaptureOverview {
  const processing = new Set<CaptureStatus>([
    'queued', 'reading', 'distilling', 'reconciling', 'committing', 'retry_wait',
  ])
  const keyOf = (provider: 'claude' | 'codex', sessionId: string) =>
    `${provider}\u0000${sessionId}`
  const discoveredSessionKeys = new Set(
    sessions.map((session) => keyOf(session.provider, session.id)),
  )
  const actionableErrorIds = new Set(actionableCaptureFailures(jobs).map((job) => job.id))
  // The queue is durable history and may contain thousands of sessions no
  // longer offered by the provider. Recovered migration-era errors are also
  // history, not present work.
  const discoveredJobs = jobs.filter(
    (job) =>
      discoveredSessionKeys.has(keyOf(job.provider, job.sessionId)) &&
      (job.status !== 'error' || actionableErrorIds.has(job.id)),
  )
  const trackedSessionKeys = new Set(
    discoveredJobs.map((job) => keyOf(job.provider, job.sessionId)),
  )
  // Preserve already-tracked sessions even after they age out so their latest
  // capture remains visible. An untracked old transcript is intentionally
  // outside the automatic capture window and must not dilute coverage.
  const relevantSessions = sessions.filter((session) => {
    const key = keyOf(session.provider, session.id)
    if (trackedSessionKeys.has(key) || session.lastActiveAt === undefined) return true
    const lastActiveMs = Date.parse(session.lastActiveAt)
    return !Number.isNaN(lastActiveMs) && nowMs - lastActiveMs <= MEMORY_CAPTURE_RECENT_MS
  })
  const relevantSessionKeys = new Set(
    relevantSessions.map((session) => keyOf(session.provider, session.id)),
  )
  const currentJobs = discoveredJobs.filter((job) =>
    relevantSessionKeys.has(keyOf(job.provider, job.sessionId)),
  )
  const currentJobsBySession = new Map(
    currentJobs.map((job) => [keyOf(job.provider, job.sessionId), job]),
  )
  const providerBlockers = new Map<'claude' | 'codex', CaptureJob>()
  for (const job of currentJobs) {
    if (
      job.status !== 'blocked' ||
      classifyCaptureFailure(job.error ?? '').scope !== 'provider'
    ) continue
    const existing = providerBlockers.get(job.provider)
    if (!existing || job.updatedAt > existing.updatedAt) providerBlockers.set(job.provider, job)
  }
  const providers = (['claude', 'codex'] as const).map((provider) => {
    const providerSessions = relevantSessions.filter((item) => item.provider === provider)
    const providerJobs = currentJobs.filter((item) => item.provider === provider)
    const done = providerJobs.filter((item) => item.status === 'done')
    const captured = providerSessions.filter((session) => {
      const current = currentJobsBySession.get(keyOf(provider, session.id))
      if (current?.status !== 'done') return false
      return session.sizeBytes === undefined || current.lastOffset >= session.sizeBytes
    }).length
    const pending = providerSessions.filter((session) => {
      const current = currentJobsBySession.get(keyOf(provider, session.id))
      if (!current) return true
      if (processing.has(current.status)) return true
      return (
        current.status === 'done' &&
        session.sizeBytes !== undefined &&
        current.lastOffset < session.sizeBytes
      )
    }).length
    const lastCapturedAt = done
      .map((item) => item.updatedAt)
      .sort()
      .at(-1) ?? null
    return {
      provider,
      sessions: providerSessions.length,
      captured,
      pending,
      blocked: providerJobs.filter((item) => item.status === 'blocked' || item.status === 'error').length,
      lastCapturedAt,
    }
  })
  return {
    providers,
    jobs: currentJobs
      .filter((item) => {
        const blocker = providerBlockers.get(item.provider)
        return !blocker || item.status === 'done' || item.id === blocker.id
      })
      .map((item) => ({
        id: item.id,
        provider: item.provider,
        status: item.status,
        attempts: item.attempts,
        nextRetryAt: item.nextRetryAt,
        guidance: item.guidance,
        updatedAt: item.updatedAt,
      })),
  }
}
