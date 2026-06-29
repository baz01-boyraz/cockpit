/**
 * Insight recency classification (pure, testable).
 *
 * An insight is a record that a known failure shape was *observed* in the
 * project's terminal/log output — it is history, not live process state. We
 * cannot honestly claim an error "is happening right now" without re-running the
 * command, so we classify by how recently the error was last seen and label it
 * with a concrete timestamp. No guessing, no fabricated "live" status.
 */
import type { ErrorInsight } from './domain'

/**
 * - `active`  — last seen within the last few minutes (a build/run that just
 *   emitted this error; very likely still relevant).
 * - `recent`  — seen within the last hour.
 * - `earlier` — older; kept as history until it recurs or is dismissed.
 */
export type InsightRecency = 'active' | 'recent' | 'earlier'

export const ACTIVE_WINDOW_MS = 5 * 60_000
export const RECENT_WINDOW_MS = 60 * 60_000

/** Classify how fresh an insight is from its last-seen timestamp. */
export function classifyInsightRecency(lastSeenIso: string, now: number = Date.now()): InsightRecency {
  const then = new Date(lastSeenIso).getTime()
  if (Number.isNaN(then)) return 'earlier'
  const delta = now - then
  if (delta <= ACTIVE_WINDOW_MS) return 'active'
  if (delta <= RECENT_WINDOW_MS) return 'recent'
  return 'earlier'
}

export const RECENCY_LABEL: Record<InsightRecency, string> = {
  active: 'active',
  recent: 'recent',
  earlier: 'earlier',
}

/** Human description used in tooltips/empty states. */
export const RECENCY_HINT: Record<InsightRecency, string> = {
  active: 'Seen in the last few minutes — likely still relevant.',
  recent: 'Seen within the last hour.',
  earlier: 'Older occurrence kept as history; will resurface if it happens again.',
}

/** Convenience: classify directly from an insight's lastSeenAt. */
export function insightRecency(insight: Pick<ErrorInsight, 'lastSeenAt'>, now?: number): InsightRecency {
  return classifyInsightRecency(insight.lastSeenAt, now)
}
