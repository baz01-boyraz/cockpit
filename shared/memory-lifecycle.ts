const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/** Conservative pressure thresholds: isolated routine events stay silent. */
export const MEMORY_LIFECYCLE_POLICY = {
  distillerFailures: { count: 2, windowMs: 15 * MINUTE_MS },
  gateRejects: { count: 3, windowMs: 15 * MINUTE_MS },
  complianceMisses: { count: 2, windowMs: 30 * MINUTE_MS },
  curationFailures: { count: 2, windowMs: DAY_MS },
  reviewBacklog: 15,
  reviewConflicts: 3,
  reviewAging: { count: 5, ageMs: 7 * DAY_MS },
  curationStaleMs: 10 * DAY_MS,
} as const

export type MemoryFailureKind =
  | 'timeout'
  | 'parse'
  | 'missing-input'
  | 'spawn'
  | 'unknown'

/** Reduce raw operational errors to a closed, content-free category. */
export function classifyMemoryFailure(message: string): MemoryFailureKind {
  if (/timed?\s*out|timeout|killed|sigterm/i.test(message)) return 'timeout'
  if (/invalid\s+json|parse|unparseable|garbage|observations?\s+array/i.test(message)) return 'parse'
  if (/enoent|missing|not\s+found|no\s+such\s+file|transcript.*absent/i.test(message)) {
    return 'missing-input'
  }
  if (/spawn|eacces|eperm|executable|command\s+failed|cli\s+failed/i.test(message)) return 'spawn'
  return 'unknown'
}
