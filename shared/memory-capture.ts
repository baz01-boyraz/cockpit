/**
 * Capture-queue domain types (docs/memory-imp.md G2). Pure shapes shared by the
 * queue service, the IPC contract, and the mock. The queue is the durability
 * boundary: a session enqueued here survives quit/crash and is never dropped.
 */

export const CAPTURE_STATUSES = ['queued', 'processing', 'done', 'error'] as const
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number]

export interface CaptureJob {
  id: string
  projectId: string
  sessionId: string
  sourcePath: string
  status: CaptureStatus
  /** Byte cursor — only turns past this offset are distilled next time. */
  lastOffset: number
  attempts: number
  error: string | null
  enqueuedAt: string
  updatedAt: string
}

/** Give up auto-retrying a session after this many failed attempts. */
export const CAPTURE_MAX_ATTEMPTS = 3
