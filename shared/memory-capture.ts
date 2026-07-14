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

export type CaptureFailureDisposition = 'blocked' | 'retry'

export function classifyCaptureFailure(message: string): {
  disposition: CaptureFailureDisposition
  guidance: string
} {
  if (/openrouter[^\n]*(?:key|secret)|api\s*key|credential|configure[^\n]*settings/i.test(message)) {
    return {
      disposition: 'blocked',
      guidance: 'Add or verify the OpenRouter key in Settings, then press Retry.',
    }
  }
  if (/enoent|missing[^\n]*transcript|no\s+such\s+file|transcript[^\n]*(?:absent|not\s+found)/i.test(message)) {
    return {
      disposition: 'blocked',
      guidance: 'The provider transcript is unavailable. Restore it or capture a newer session, then press Retry.',
    }
  }
  return {
    disposition: 'retry',
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

export function assembleMemoryCaptureOverview(
  sessions: readonly { provider: 'claude' | 'codex' }[],
  jobs: readonly CaptureJob[],
): MemoryCaptureOverview {
  const processing = new Set<CaptureStatus>([
    'queued', 'reading', 'distilling', 'reconciling', 'committing', 'retry_wait',
  ])
  const providers = (['claude', 'codex'] as const).map((provider) => {
    const providerJobs = jobs.filter((item) => item.provider === provider)
    const done = providerJobs.filter((item) => item.status === 'done')
    const lastCapturedAt = done
      .map((item) => item.updatedAt)
      .sort()
      .at(-1) ?? null
    return {
      provider,
      sessions: sessions.filter((item) => item.provider === provider).length,
      captured: done.length,
      pending: providerJobs.filter((item) => processing.has(item.status)).length,
      blocked: providerJobs.filter((item) => item.status === 'blocked' || item.status === 'error').length,
      lastCapturedAt,
    }
  })
  return {
    providers,
    jobs: jobs.map((item) => ({
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
